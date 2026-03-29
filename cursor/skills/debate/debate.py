#!/usr/bin/env python3
"""
debate.py — Multi-agent code debate orchestrator.

Spawns 3 Cursor Agent CLI processes in parallel without --model, so each run
uses the CLI default (auto) model. Aggregates findings, runs a vote phase,
and produces a scored debate report.

Usage:
    python debate.py <target-directory> [--timeout 300]
    python debate.py C:/Users/rentk/mihir/main
"""

import subprocess
import json
import sys
import os
import re
import time
import argparse
import threading
import webbrowser
from pathlib import Path
from datetime import datetime

from ui_server import start_ui_server
# ── Config ────────────────────────────────────────────────────────────────────

NUM_AGENTS = 3

_agent_paths_cache: tuple[Path | None, Path | None] | None = None
_stream_lock = threading.Lock()


def append_stream_chunk(work_dir: Path, payload: dict):
    """Append one NDJSON line to stream.jsonl (thread-safe)."""
    payload.setdefault("ts", datetime.now().isoformat())
    payload.setdefault("run_id", work_dir.name)
    path = work_dir / "stream.jsonl"
    line = json.dumps(payload, ensure_ascii=False) + "\n"
    with _stream_lock:
        with path.open("a", encoding="utf-8") as f:
            f.write(line)


def resolve_cursor_agent_paths() -> tuple[Path | None, Path | None]:
    """Locate node.exe + index.js for the installed Cursor Agent CLI.

    Order: CURSOR_AGENT_NODE + CURSOR_AGENT_INDEX env vars, then newest folder
    under %LOCALAPPDATA%/cursor-agent/versions/. Hardcoded per-user paths break
    after upgrades or on other machines.
    """
    env_node = os.environ.get("CURSOR_AGENT_NODE")
    env_idx = os.environ.get("CURSOR_AGENT_INDEX")
    if env_node and env_idx:
        return Path(env_node), Path(env_idx)

    local = os.environ.get("LOCALAPPDATA")
    if not local:
        return None, None
    versions_dir = Path(local) / "cursor-agent" / "versions"
    if not versions_dir.is_dir():
        return None, None

    candidates = sorted(
        (p for p in versions_dir.iterdir() if p.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )
    for d in candidates:
        node, idx = d / "node.exe", d / "index.js"
        if node.is_file() and idx.is_file():
            return node, idx
    return None, None


def get_agent_paths() -> tuple[Path, Path]:
    global _agent_paths_cache
    if _agent_paths_cache is None:
        _agent_paths_cache = resolve_cursor_agent_paths()
    n, i = _agent_paths_cache
    if n is None or i is None:
        raise FileNotFoundError(
            "Cursor Agent CLI not found. Install/update the Cursor Agent, or set "
            "CURSOR_AGENT_NODE and CURSOR_AGENT_INDEX to node.exe and index.js "
            "under a cursor-agent versions folder."
        )
    return n, i

# ── Personas & prompts ───────────────────────────────────────────────────────

DEBATER_PERSONAS: list[dict] = [
    {
        "key": "swe",
        "display_name": "Alex — Software Engineer",
        "short": "SWE",
        "title": "Staff-level software engineer (systems & delivery)",
        "intent": "Ship maintainable, correct software: clear boundaries, tests where they earn their keep, observability, and pragmatic refactors.",
        "logic_nodes": """Follow this internal flow (do not print these steps; use them to think):
1. Intent — What is this product trying to ship? Who operates it?
2. Map — Entrypoints, modules, data flow, external deps, deploy shape.
3. Risk — Correctness, security, performance cliffs, reliability, coupling.
4. Evidence — Every finding must cite a concrete path and a specific failure mode or cost.
5. Verdict — Severity reflects user impact × fix cost × likelihood.""",
        "finding_lens": "Prioritize: correctness, architecture, security, scalability, maintainability, code quality. De-emphasize pure style unless it blocks velocity.",
        "debate_open": "Open from an engineering lens: is the finding real, how severe for the system, and what shape of fix or mitigation fits?",
        "debate_challenge": "Challenge weak evidence, missing context, or over-scoped fixes; cite code if you disagree.",
        "debate_resolve": "Resolve with an engineering judgment: agree/disagree with a crisp technical rationale.",
        "plan_heading": "Engineering execution",
        "plan_brief": "Concrete technical work: refactors, tests, monitoring, API contracts, performance, security hardening. Include file paths.",
    },
    {
        "key": "ux",
        "display_name": "Jordan — UI/UX",
        "short": "UX",
        "title": "Senior UI/UX developer (product craft & accessibility)",
        "intent": "Make experiences coherent, accessible, and shippable: flows, states, design consistency, and honest edge-case handling.",
        "logic_nodes": """Internal flow:
1. Intent — Who uses this? Primary jobs-to-be-done in the UI.
2. Surface map — Screens, components, navigation, empty/loading/error states.
3. Heuristics — Nielsen-style + platform a11y (focus, contrast, keyboard, semantics).
4. Evidence — Tie findings to components, routes, CSS, strings, or assets.
5. Verdict — Severity = user pain × frequency × fix effort.""",
        "finding_lens": "Prioritize: usability, accessibility, information architecture, visual/interaction consistency, copy clarity, responsive behavior, design-system alignment.",
        "debate_open": "Open from UX: does this finding affect real users, and is the issue framed with the right severity?",
        "debate_challenge": "Push back on engineer-only framing; demand user-visible impact or downgrade noise.",
        "debate_resolve": "Resolve with a UX judgment: does this block adoption, trust, or compliance (a11y)?",
        "plan_heading": "UX & product surface",
        "plan_brief": "UI work: flows, components, a11y fixes, copy, design tokens, empty/error states. Name screens or components when possible.",
    },
    {
        "key": "pm",
        "display_name": "Sam — Product",
        "short": "PM",
        "title": "Senior product manager (quality bar & shipping)",
        "intent": "Ship the right thing on time: clarify outcomes, cut scope smartly, manage risk, and keep quality visible to stakeholders.",
        "logic_nodes": """Internal flow:
1. Intent — What outcome are we optimizing (growth, risk reduction, velocity)?
2. Stakeholders — Who decides, who suffers if we fail, what is non-negotiable?
3. Value × effort — Rough sizing; distinguish P0 launch blockers vs debt.
4. Dependencies — Sequencing, contracts with eng/design, rollout and comms.
5. Verdict — Tie severity to business or delivery risk, not taste.""",
        "finding_lens": "Prioritize: user value, scope risk, delivery risk, metrics, onboarding, compliance deadlines, tech-debt tradeoffs that affect roadmap.",
        "debate_open": "Open from product: is this finding worth prioritizing vs other work, and what is the user or business consequence?",
        "debate_challenge": "Challenge findings that are technically true but low user impact or poor sequencing.",
        "debate_resolve": "Resolve with a product judgment: ship, defer, or cut — with rationale tied to outcomes.",
        "plan_heading": "Roadmap & shipping",
        "plan_brief": "Prioritized initiatives (P0/P1/P2), milestones, risks, success metrics, and what to cut or defer.",
    },
]


def persona_for_slot(slot: int) -> dict:
    return DEBATER_PERSONAS[slot % len(DEBATER_PERSONAS)]


def build_eval_prompt(persona: dict) -> str:
    return rf"""You are **{persona["display_name"]}** — {persona["title"]}.

**Your intent:** {persona["intent"]}

**How you must reason (logic nodes):**
{persona["logic_nodes"]}

**Finding lens (what to hunt for):** {persona["finding_lens"]}

Do two things:

1. **SCAN:** Use your tools on the workspace. Infer project purpose, architecture, tech stack, and key files.

2. **EVALUATE:** Produce specific, path-level findings aligned with your lens. Each finding MUST reference a file or directory relative to workspace root.

Output your response as a single JSON code block with this exact schema:

```json
{{"scan":{{"project_name":"string","purpose":"string","tech_stack":["string"],"architecture":"string","key_files":["relative/path"],"loc_estimate":"string"}},"findings":[{{"path":"relative/file/path","category":"quality|correctness|docs|architecture|security","severity":"critical|major|minor","description":"string (specific, actionable, 1-3 sentences)"}}]}}
```

Rules:
- Produce 5 to 20 findings.
- Every finding MUST reference a specific path. No generic advice.
- Be opinionated from **your** role; overlap with other reviewers is OK.
- Output ONLY the JSON code block."""


def build_vote_prompt(findings_json: str, persona: dict) -> str:
    return rf"""You are **{persona["display_name"]}** ({persona["title"]}) voting on aggregated code-review findings.
Apply your lens: {persona["finding_lens"]}
Use your reasoning discipline:
{persona["logic_nodes"]}

The workspace is open — inspect files to verify findings before voting.

Findings:

```json
{findings_json}
```

For each finding, vote:
- "agree" if valid and actionable from your perspective
- "disagree" if incorrect, irrelevant, or not worth the opportunity cost

Output a single JSON code block with this schema:

```json
{{"votes":[{{"id":"F-001","vote":"agree|disagree","comment":"optional, 1 sentence if disagreeing or adding nuance"}}]}}
```

Rules:
- Vote on EVERY finding. Do not skip any.
- Be honest. Output ONLY the JSON code block."""


TURN_ROLES = ("open", "challenge", "resolve")


def slot_for_turn(turn_idx: int, num_agents: int) -> int:
    """Map turn 0,1,2 to agent slots (open, challenge, resolve)."""
    if num_agents >= 3:
        return min(turn_idx, 2)
    return turn_idx % num_agents


def build_turn_prompt(
    finding: dict,
    role: str,
    prior_summary: str,
    persona: dict,
) -> str:
    fid = finding.get("id", "?")
    path = finding.get("path", "")
    sev = finding.get("severity", "")
    cat = finding.get("category", "")
    desc = finding.get("description", "")
    role_instr = {
        "open": persona.get("debate_open", ""),
        "challenge": persona.get("debate_challenge", ""),
        "resolve": persona.get("debate_resolve", ""),
    }.get(role, "Comment on this finding.")

    prior_block = prior_summary.strip() or "(no prior turns yet for this finding.)"

    return rf"""You are **{persona["display_name"]}** — {persona["title"]}.
**Intent:** {persona["intent"]}

**Your reasoning discipline (use internally):**
{persona["logic_nodes"]}

Structured debate about **one** aggregated finding. Workspace is open — inspect files as needed.

Finding ID: {fid}
Path: {path}
Category: {cat}
Severity: {sev}
Description: {desc}

Prior turns (summary of what other debaters said this round):
{prior_block}

**Your turn ({role}):** {role_instr}

Output a single JSON code block with this exact schema:

```json
{{"vote":"agree|disagree","stance":"one short sentence","rationale":"2-4 sentences","confidence":"high|medium|low"}}
```

Rules:
- vote "agree" if the finding is valid and actionable; "disagree" if it should be rejected or is too weak.
- Base your answer on the code, not politeness.
- Output ONLY the JSON code block."""


# ── Helpers ───────────────────────────────────────────────────────────────────

def strip_ansi(text: str) -> str:
    return re.sub(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\[\?[0-9;]*[a-zA-Z]|\x1b\].*?\x07', '', text)


def extract_json_from_text(text: str):
    """Extract the last JSON code-fence block from agent text output."""
    text = strip_ansi(text)
    # Try ```json ... ``` fences
    matches = re.findall(r'```(?:json)?\s*\n(.*?)```', text, re.DOTALL)
    for block in reversed(matches):
        block = block.strip()
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            continue
    # Fallback: try to find raw JSON objects
    for m in re.finditer(r'\{[\s\S]*\}', text):
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            continue
    return None


def write_status(status_file: Path, data: dict):
    data["updated_at"] = datetime.now().isoformat()
    status_file.write_text(json.dumps(data, indent=2), encoding="utf-8")


def log_tail_bytes(path: Path, max_bytes: int = 16000) -> str:
    if not path.is_file():
        return ""
    try:
        raw = path.read_bytes()
        if len(raw) > max_bytes:
            return "…" + raw[-max_bytes:].decode("utf-8", errors="replace")
        return raw.decode("utf-8", errors="replace")
    except OSError:
        return ""


def append_event(work_dir: Path, event: dict):
    """Append one JSON line to events.jsonl (Debate Hall transcript)."""
    event.setdefault("ts", datetime.now().isoformat())
    p = work_dir / "events.jsonl"
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def find_git_root(path: Path) -> Path | None:
    cur = path.resolve()
    if not cur.is_dir():
        cur = cur.parent
    while True:
        if (cur / ".git").exists():
            return cur
        parent = cur.parent
        if parent == cur:
            return None
        cur = parent


def create_parallel_workspaces(
    target: Path,
    work_dir: Path,
    num_agents: int,
    use_worktrees: bool,
) -> tuple[list[str], Path | None, list[Path]]:
    """
    Per-agent workspace paths. Optional git worktrees at the same commit for slots 1..n-1
    so parallel agents see isolated checkouts (ask mode; useful for reproducibility).
    Returns (paths, git_root_for_cleanup, worktree_paths_to_remove).
    """
    base = str(target.resolve())
    paths = [base] * num_agents
    if not use_worktrees or num_agents < 2:
        return paths, None, []
    root = find_git_root(target)
    if root is None:
        print("[git-worktrees] Target not inside a git repo; using one workspace for all agents.")
        return paths, None, []
    wt_parent = work_dir / "git_worktrees"
    wt_parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if r.returncode != 0:
        print("[git-worktrees] Could not read HEAD; using single workspace.")
        return paths, None, []
    commit = (r.stdout or "").strip()
    if not commit:
        return paths, None, []
    to_remove: list[Path] = []
    paths[0] = base
    for i in range(1, num_agents):
        wt = wt_parent / f"slot_{i}"
        if wt.is_dir():
            subprocess.run(
                ["git", "-C", str(root), "worktree", "remove", "--force", str(wt)],
                capture_output=True,
                timeout=120,
            )
        r2 = subprocess.run(
            ["git", "-C", str(root), "worktree", "add", "--detach", str(wt), commit],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if r2.returncode != 0:
            err = (r2.stderr or r2.stdout or "").strip()[:300]
            print(f"[git-worktrees] worktree add failed for slot {i} ({err}); using primary tree.")
            paths[i] = base
        else:
            paths[i] = str(wt.resolve())
            to_remove.append(wt)
    print(f"[git-worktrees] {len(to_remove)} extra worktree(s) at {commit[:8]}…")
    return paths, root, to_remove


def cleanup_git_worktrees(git_root: Path | None, worktree_paths: list[Path]) -> None:
    if git_root is None or not worktree_paths:
        return
    for wt in worktree_paths:
        subprocess.run(
            ["git", "-C", str(git_root), "worktree", "remove", "--force", str(wt)],
            capture_output=True,
            timeout=120,
        )


def build_improvement_plan_prompt(persona: dict, draft_so_far: str, context: dict) -> str:
    findings_json = json.dumps(context.get("findings_brief", []), indent=2)[:24000]
    return rf"""You are **{persona["display_name"]}** — {persona["title"]}.
**Intent:** {persona["intent"]}
**Your planning lens:** {persona["plan_brief"]}

Context from the completed debate:
- Project: {context.get("project_name", "?")}
- Score: {context.get("score")}/100 — {context.get("rating", "")}
- Summary of findings (id, path, severity, agrees, description):
```json
{findings_json}
```

Current shared improvement plan draft (do not delete others' sections; only add yours):
---
{draft_so_far}
---

**Task:** Append **one new markdown section** starting exactly with:
## {persona["plan_heading"]}

Use bullets and sub-bullets. Reference paths or UI areas. Be actionable for the next 2–6 weeks.
If you have no material additions, write one line: _No additional items from this lens._
Output **only** the new section (starting with ## …), no preamble."""


def phase_improvement_plan(
    work_dir: Path,
    workspace_primary: str,
    timeout: int,
    status_file: Path,
    target: str,
    scan: dict,
    findings: list[dict],
    score: int,
    rating: str,
) -> None:
    print("\n=== OPTIONAL: Improvement plan (3 persona passes) ===")
    plan_path = work_dir / "improvement-plan.md"
    header = (
        "# Improvement plan\n\n"
        "_Synthesized after the multi-persona debate. "
        "Each role appended their lane; edit as a team._\n\n"
        f"- Target: `{target}`\n"
        f"- Score: {score}/100 — {rating}\n\n"
    )
    plan_path.write_text(header, encoding="utf-8")

    brief = [
        {
            "id": f.get("id"),
            "path": f.get("path"),
            "severity": f.get("severity"),
            "agrees": f.get("agrees"),
            "description": (f.get("description") or "")[:400],
        }
        for f in findings
    ]
    ctx = {
        "project_name": scan.get("project_name", "Unknown"),
        "score": score,
        "rating": rating,
        "findings_brief": brief,
    }

    write_status(
        status_file,
        {
            "phase": "improvement_plan",
            "target": target,
            "improvement_plan": True,
        },
    )

    for slot in range(min(3, len(DEBATER_PERSONAS))):
        persona = DEBATER_PERSONAS[slot]
        draft = plan_path.read_text(encoding="utf-8", errors="replace")
        prompt = build_improvement_plan_prompt(persona, draft, ctx)
        out = work_dir / f"improvement_plan_pass_{persona['key']}.txt"
        runner = AgentRunner(
            slot,
            workspace_primary,
            prompt,
            out,
            timeout,
            work_dir=work_dir,
            display_name=persona["display_name"],
            persona_key=persona["key"],
            stream_meta={
                "phase": "improvement_plan",
                "finding_id": None,
                "role": persona["key"],
                "persona": persona["key"],
            },
        )
        runner.run()
        block = ""
        if runner.status == "completed" and out.is_file():
            raw = out.read_text(encoding="utf-8", errors="replace").strip()
            block = raw if raw.startswith("##") else f"## {persona['plan_heading']}\n\n{raw}\n"
        else:
            block = f"## {persona['plan_heading']}\n\n_(Pass failed: {runner.error})_\n"
        with plan_path.open("a", encoding="utf-8") as f:
            f.write("\n" + block + "\n")

        append_event(
            work_dir,
            {
                "kind": "stage_output",
                "stage": "improvement_plan",
                "title": f"Plan: {persona['short']}",
                "subtitle": persona["plan_heading"],
                "body": block[:6000],
            },
        )

    write_status(
        status_file,
        {
            "phase": "improvement_plan_done",
            "target": target,
            "improvement_plan_path": str(plan_path),
        },
    )
    print(f"  Improvement plan: {plan_path}")


# ── Agent Runner ──────────────────────────────────────────────────────────────

class AgentRunner:
    """Runs a single cursor-agent process; optional live stream to stream.jsonl."""

    def __init__(
        self,
        slot: int,
        workspace: str,
        prompt: str,
        output_path: Path,
        timeout: int = 300,
        *,
        work_dir: Path | None = None,
        stream_meta: dict | None = None,
        display_name: str | None = None,
        persona_key: str | None = None,
    ):
        self.slot = slot
        self.persona_key = persona_key
        self.name = display_name or f"Agent {slot + 1}"
        self.workspace = workspace
        self.prompt = prompt
        self.output_path = output_path
        self.timeout = timeout
        self.work_dir = work_dir
        self.stream_meta = stream_meta or {}
        self.proc = None
        self.status = "pending"
        self.error = None
        self.pid = None
        self.start_time = None
        self.end_time = None

    def _run_with_stream_pipe(self, cmd: list, env: dict, creation_flags: int):
        self.proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            creationflags=creation_flags,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        self.pid = self.proc.pid
        print(f"  [{self.name}] Started (PID {self.pid})")
        wd = self.work_dir
        meta = {k: v for k, v in self.stream_meta.items() if v is not None}

        def reader():
            try:
                with open(self.output_path, "w", encoding="utf-8") as out_f:
                    assert self.proc.stdout is not None
                    while True:
                        line = self.proc.stdout.readline()
                        if not line:
                            break
                        out_f.write(line)
                        out_f.flush()
                        append_stream_chunk(
                            wd,
                            {
                                "phase": meta.get("phase", "agent"),
                                "finding_id": meta.get("finding_id"),
                                "role": meta.get("role"),
                                "persona": meta.get("persona"),
                                "agent": self.name,
                                "chunk": line.rstrip("\n\r"),
                            },
                        )
            except Exception as ex:
                append_stream_chunk(
                    wd,
                    {
                        "phase": meta.get("phase", "agent"),
                        "finding_id": meta.get("finding_id"),
                        "role": meta.get("role"),
                        "persona": meta.get("persona"),
                        "agent": self.name,
                        "chunk": f"[stream reader error] {ex}",
                    },
                )
            finally:
                try:
                    self.proc.stdout.close()
                except Exception:
                    pass

        t = threading.Thread(target=reader, daemon=True, name=f"stream-{self.pid}")
        t.start()
        try:
            self.proc.wait(timeout=self.timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
            raise
        finally:
            t.join(timeout=5)

    def _run_with_file_stdout(self, cmd: list, env: dict, creation_flags: int):
        with open(self.output_path, "w", encoding="utf-8") as out_f:
            self.proc = subprocess.Popen(
                cmd,
                stdout=out_f,
                stderr=subprocess.STDOUT,
                env=env,
                creationflags=creation_flags,
            )
        self.pid = self.proc.pid
        print(f"  [{self.name}] Started (PID {self.pid})")
        self.proc.wait(timeout=self.timeout)

    def run(self):
        """Run the agent. Blocks until completion or timeout."""
        self.status = "running"
        self.start_time = time.time()

        env = os.environ.copy()
        env["CURSOR_INVOKED_AS"] = "agent"
        env.pop("NODE_COMPILE_CACHE", None)

        try:
            agent_node, agent_index = get_agent_paths()
        except FileNotFoundError as e:
            self.end_time = time.time()
            self.status = "failed"
            self.error = str(e)
            print(f"  [{self.name}] ERROR: {e}")
            return

        cmd = [
            str(agent_node), str(agent_index),
            "-p",
            "--output-format", "text",
            "--mode", "ask",
            "--trust",
            "--workspace", self.workspace,
            self.prompt,
        ]

        creation_flags = 0
        if sys.platform == "win32":
            creation_flags = subprocess.CREATE_NO_WINDOW

        use_stream = self.work_dir is not None

        try:
            if use_stream:
                self._run_with_stream_pipe(cmd, env, creation_flags)
            else:
                self._run_with_file_stdout(cmd, env, creation_flags)
            self.end_time = time.time()

            if self.proc.returncode != 0:
                self.status = "failed"
                self.error = f"exit code {self.proc.returncode}"
                content = self.output_path.read_text(encoding="utf-8", errors="replace").strip()
                if "usage limit" in content.lower():
                    self.error = "model usage limit hit"
                elif content:
                    self.error = content[:200]
                print(f"  [{self.name}] FAILED: {self.error}")
            else:
                size = self.output_path.stat().st_size if self.output_path.is_file() else 0
                if size == 0:
                    self.status = "failed"
                    self.error = "0 bytes output (stdout capture issue)"
                    print(f"  [{self.name}] FAILED: no output captured")
                else:
                    self.status = "completed"
                    elapsed = self.end_time - self.start_time
                    print(f"  [{self.name}] Completed ({elapsed:.0f}s, {size} bytes)")

        except subprocess.TimeoutExpired:
            if self.proc:
                self.proc.kill()
                self.proc.wait()
            self.end_time = time.time()
            self.status = "timeout"
            self.error = f"exceeded {self.timeout}s timeout"
            print(f"  [{self.name}] TIMEOUT after {self.timeout}s")

        except Exception as e:
            self.end_time = time.time()
            self.status = "failed"
            self.error = str(e)
            print(f"  [{self.name}] ERROR: {e}")

    def get_result(self):
        """Parse the output file and return extracted JSON or None."""
        if self.status != "completed":
            return None
        try:
            text = self.output_path.read_text(encoding="utf-8", errors="replace")
            return extract_json_from_text(text)
        except Exception:
            return None

    def to_dict(self):
        return {
            "slot": self.slot,
            "name": self.name,
            "persona_key": self.persona_key,
            "status": self.status,
            "pid": self.pid,
            "error": self.error,
            "elapsed": round(self.end_time - self.start_time, 1) if self.end_time and self.start_time else None,
        }


def run_agents_parallel(agents: list[AgentRunner]) -> list[AgentRunner]:
    """Run multiple agents in parallel threads."""
    threads = []
    for agent in agents:
        t = threading.Thread(target=agent.run, daemon=True)
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    return agents


# ── Phase Logic ───────────────────────────────────────────────────────────────

def phase_scan_evaluate(
    num_agents: int,
    workspaces: list[str],
    work_dir: Path,
    timeout: int,
    status_file: Path,
) -> list[AgentRunner]:
    """Phase 1+2: Scan and evaluate in parallel (persona + optional per-slot workspace)."""
    print("\n=== PHASE 1+2: Scan & Evaluate ===")
    print(f"  Primary: {workspaces[0]}")
    print(f"  Agents: {num_agents} parallel (personas: SWE / UX / PM cycle)")

    agents = []
    for i in range(num_agents):
        persona = persona_for_slot(i)
        ws = workspaces[i] if i < len(workspaces) else workspaces[0]
        out = work_dir / f"eval_{i}.txt"
        agents.append(
            AgentRunner(
                i,
                ws,
                build_eval_prompt(persona),
                out,
                timeout,
                work_dir=work_dir,
                display_name=persona["display_name"],
                persona_key=persona["key"],
                stream_meta={
                    "phase": "eval",
                    "finding_id": None,
                    "role": None,
                    "persona": persona["key"],
                },
            )
        )

    write_status(status_file, {
        "phase": "scan_evaluate",
        "agents": [a.to_dict() for a in agents],
    })

    append_event(work_dir, {
        "kind": "stage_output",
        "stage": "scan_evaluate",
        "title": "Opening statements",
        "subtitle": f"{num_agents} debaters scan and evaluate in parallel",
        "body": "Each agent writes structured JSON (scan + findings). Logs stream to eval_*.txt in this run folder.",
    })

    run_agents_parallel(agents)

    write_status(status_file, {
        "phase": "scan_evaluate_done",
        "agents": [a.to_dict() for a in agents],
    })

    ok = sum(1 for a in agents if a.status == "completed")
    append_event(work_dir, {
        "kind": "stage_output",
        "stage": "scan_evaluate",
        "title": "Opening session",
        "subtitle": "Each debater independently scanned the codebase.",
        "body": f"{ok} of {len(agents)} agents returned output. Below: latest excerpt from each agent log.",
        "agent_logs": {a.name: log_tail_bytes(a.output_path) for a in agents},
    })

    return agents


def phase_aggregate(
    eval_agents: list[AgentRunner],
    work_dir: Path,
    status_file: Path | None = None,
    target: str | None = None,
    num_agents: int | None = None,
) -> tuple[dict, list[dict]]:
    """Phase 3: Aggregate and deduplicate findings."""
    print("\n=== PHASE 3: Aggregate ===")

    if status_file is not None:
        write_status(status_file, {
            "phase": "aggregating",
            "target": target,
            "num_agents": num_agents,
            "agents": [a.to_dict() for a in eval_agents],
        })
        n_ok = sum(1 for a in eval_agents if a.status == "completed")
        append_event(work_dir, {
            "kind": "stage_output",
            "stage": "aggregating",
            "title": "Clerk of the hall",
            "subtitle": "Merging and deduplicating findings",
            "body": f"{n_ok} of {len(eval_agents)} debaters completed the opening phase; combining their JSON.",
        })

    scans = []
    all_findings = []

    for agent in eval_agents:
        result = agent.get_result()
        if not result:
            print(f"  [{agent.name}] No parseable result, skipping")
            continue

        scan = result.get("scan", {})
        findings = result.get("findings", [])
        scans.append(scan)

        for f in findings:
            f["raised_by"] = [agent.name]
            all_findings.append(f)

        print(f"  [{agent.name}] {len(findings)} findings")

    # Merge scan summaries
    merged_scan = {
        "project_name": max((s.get("project_name", "") for s in scans), key=len, default="Unknown"),
        "purpose": max((s.get("purpose", "") for s in scans), key=len, default="Unknown"),
        "tech_stack": sorted(set(t for s in scans for t in s.get("tech_stack", []))),
        "architecture": max((s.get("architecture", "") for s in scans), key=len, default="Unknown"),
        "key_files": sorted(set(f for s in scans for f in s.get("key_files", []))),
        "loc_estimate": max((s.get("loc_estimate", "") for s in scans), key=len, default="Unknown"),
    }

    # Deduplicate findings by path + category + similar description
    deduped = []
    seen = []

    for f in all_findings:
        key = (f.get("path", "").lower(), f.get("category", "").lower())
        desc = f.get("description", "").lower()

        merged = False
        for existing in seen:
            e_key = (existing.get("path", "").lower(), existing.get("category", "").lower())
            e_desc = existing.get("description", "").lower()

            if key == e_key:
                # Same path + category — check description overlap
                words_f = set(desc.split())
                words_e = set(e_desc.split())
                if len(words_f & words_e) / max(len(words_f | words_e), 1) > 0.4:
                    # Merge: add raiser, keep longer description
                    for name in f["raised_by"]:
                        if name not in existing["raised_by"]:
                            existing["raised_by"].append(name)
                    if len(f.get("description", "")) > len(existing.get("description", "")):
                        existing["description"] = f["description"]
                    merged = True
                    break

        if not merged:
            seen.append(f)

    # Assign IDs
    for i, f in enumerate(seen, 1):
        f["id"] = f"F-{i:03d}"

    print(f"  Total raw findings: {len(all_findings)}")
    print(f"  After dedup: {len(seen)}")

    if status_file is not None:
        write_status(status_file, {
            "phase": "aggregating_done",
            "target": target,
            "num_agents": num_agents,
            "findings_raw": len(all_findings),
            "findings_deduped": len(seen),
            "scan_summary": {
                "project_name": merged_scan.get("project_name", ""),
                "purpose": (merged_scan.get("purpose") or "")[:400],
            },
            "agents": [a.to_dict() for a in eval_agents],
        })

    append_event(work_dir, {
        "kind": "stage_output",
        "stage": "aggregating_done",
        "title": "Docket ready",
        "subtitle": "Findings merged and deduplicated",
        "body": f"Raw findings: {len(all_findings)}. After merge: {len(seen)}. "
                f"Project: {merged_scan.get('project_name', 'Unknown')[:120]}",
    })

    return merged_scan, seen


def phase_vote(
    num_agents: int,
    workspaces: list[str],
    findings: list[dict],
    work_dir: Path,
    timeout: int,
    status_file: Path,
) -> list[AgentRunner]:
    """Phase 4: Vote on findings in parallel (persona-specific lenses)."""
    print("\n=== PHASE 4: Vote ===")

    vote_findings = [
        {"id": f["id"], "path": f["path"], "category": f["category"],
         "severity": f["severity"], "description": f["description"]}
        for f in findings
    ]
    findings_json = json.dumps(vote_findings, indent=2)
    use_file = len(findings_json) > 4500
    vote_payload = findings_json
    if use_file:
        findings_file = work_dir / "debate_findings.json"
        findings_file.write_text(json.dumps(vote_findings, indent=2), encoding="utf-8")
        vote_payload = (
            f"[Findings written to {findings_file}. Read that file and vote on each finding.]"
        )
        print(f"  Findings JSON large; using {findings_file.name}")

    agents = []
    for i in range(num_agents):
        persona = persona_for_slot(i)
        ws = workspaces[i] if i < len(workspaces) else workspaces[0]
        prompt = build_vote_prompt(vote_payload, persona)
        out = work_dir / f"vote_{i}.txt"
        agents.append(
            AgentRunner(
                i,
                ws,
                prompt,
                out,
                timeout,
                work_dir=work_dir,
                display_name=persona["display_name"],
                persona_key=persona["key"],
                stream_meta={
                    "phase": "vote",
                    "finding_id": None,
                    "role": None,
                    "persona": persona["key"],
                },
            )
        )

    write_status(status_file, {
        "phase": "voting",
        "agents": [a.to_dict() for a in agents],
        "findings_count": len(findings),
    })

    append_event(work_dir, {
        "kind": "stage_output",
        "stage": "voting",
        "title": "Vote called",
        "subtitle": f"{len(findings)} findings on the ballot",
        "body": "Each debater inspects the workspace and returns agree/disagree votes (vote_*.txt).",
    })

    run_agents_parallel(agents)

    write_status(status_file, {
        "phase": "voting_done",
        "agents": [a.to_dict() for a in agents],
    })

    append_event(work_dir, {
        "kind": "stage_output",
        "stage": "voting_done",
        "title": "Ballots in",
        "subtitle": "Each debater voted agree/disagree on every finding",
        "body": f"Recorded votes for {len(findings)} findings. Below: tail of each vote log.",
        "agent_logs": {a.name: log_tail_bytes(a.output_path) for a in agents},
    })

    return agents


def _append_debate_turn_jsonl(work_dir: Path, record: dict):
    record.setdefault("ts", datetime.now().isoformat())
    p = work_dir / "debate_turns.jsonl"
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def write_debate_graph_mermaid(work_dir: Path, steps: list[dict]) -> None:
    """steps: {id, label, finding_id, role} for Mermaid flowchart."""
    lines = ["flowchart TD", "  nStart((start))"]
    prev = "nStart"
    for i, s in enumerate(steps):
        nid = s.get("id", f"s{i}")
        safe_label = (s.get("label") or nid).replace('"', "'")[:80]
        lines.append(f'  {nid}["{safe_label}"]')
        lines.append(f"  {prev} --> {nid}")
        prev = nid
    lines.append(f"  {prev} --> nDone((done))")
    (work_dir / "debate_graph.mermaid").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_debate_graph_excalidraw(work_dir: Path, steps: list[dict]) -> None:
    """Minimal Excalidraw JSON (import at excalidraw.com)."""
    elements = []
    y = 40
    prev_id = None
    for i, s in enumerate(steps):
        eid = f"step_{i}_{s.get('id', i)}"
        label = (s.get("label") or "")[:120]
        el = {
            "type": "rectangle",
            "version": 1,
            "versionNonce": i + 1,
            "isDeleted": False,
            "id": eid,
            "fillStyle": "solid",
            "strokeWidth": 2,
            "strokeStyle": "solid",
            "roughness": 1,
            "opacity": 100,
            "angle": 0,
            "x": 200,
            "y": y,
            "strokeColor": "#1e1e1e",
            "backgroundColor": "#e3f2fd",
            "width": 220,
            "height": 56,
            "seed": 1000 + i,
            "groupIds": [],
            "frameId": None,
            "roundness": {"type": 3},
            "boundElements": None,
            "updated": 1,
            "link": None,
            "locked": False,
        }
        elements.append(el)
        txt = {
            "type": "text",
            "version": 1,
            "versionNonce": i + 500,
            "isDeleted": False,
            "id": f"{eid}_t",
            "fillStyle": "solid",
            "strokeWidth": 1,
            "strokeStyle": "solid",
            "roughness": 1,
            "opacity": 100,
            "angle": 0,
            "x": 210,
            "y": y + 18,
            "strokeColor": "#1e1e1e",
            "backgroundColor": "transparent",
            "width": 200,
            "height": 24,
            "seed": 2000 + i,
            "groupIds": [],
            "frameId": None,
            "roundness": None,
            "boundElements": None,
            "updated": 1,
            "link": None,
            "locked": False,
            "fontSize": 12,
            "fontFamily": 1,
            "text": label,
            "textAlign": "center",
            "verticalAlign": "middle",
            "containerId": None,
            "originalText": label,
            "lineHeight": 1.25,
        }
        elements.append(txt)
        if prev_id is not None:
            arrow = {
                "type": "arrow",
                "version": 1,
                "versionNonce": i + 900,
                "isDeleted": False,
                "id": f"arr_{i}",
                "fillStyle": "solid",
                "strokeWidth": 2,
                "strokeStyle": "solid",
                "roughness": 1,
                "opacity": 100,
                "angle": 0,
                "x": 310,
                "y": y - 24,
                "strokeColor": "#1e1e1e",
                "backgroundColor": "transparent",
                "width": 0,
                "height": 32,
                "seed": 3000 + i,
                "groupIds": [],
                "frameId": None,
                "roundness": {"type": 2},
                "boundElements": None,
                "updated": 1,
                "link": None,
                "locked": False,
                "startBindingId": None,
                "endBindingId": None,
                "lastCommittedPoint": None,
                "startArrowhead": None,
                "endArrowhead": "arrow",
                "points": [[0, 0], [0, 32]],
            }
            elements.append(arrow)
        prev_id = eid
        y += 88

    doc = {
        "type": "excalidraw",
        "version": 2,
        "source": "debate-hall",
        "elements": elements,
        "appState": {"viewBackgroundColor": "#ffffff"},
        "files": {},
    }
    (work_dir / "debate_graph.excalidraw.json").write_text(
        json.dumps(doc, indent=2), encoding="utf-8"
    )


def phase_sequential_findings_debate(
    num_agents: int,
    workspaces: list[str],
    findings: list[dict],
    work_dir: Path,
    timeout: int,
    status_file: Path,
    target: str,
    max_findings: int | None = None,
) -> tuple[dict[str, list[dict]], list[dict]]:
    """
    For each finding, run open → challenge → resolve sequentially (one agent each).
    Returns (vote_rows_by_finding_id, debate_track_steps for viz).
    """
    print("\n=== PHASE 4 (sequential): Debate each finding ===")
    turns_dir = work_dir / "debate_turns"
    turns_dir.mkdir(parents=True, exist_ok=True)
    if (work_dir / "debate_turns.jsonl").is_file():
        (work_dir / "debate_turns.jsonl").unlink()

    append_event(
        work_dir,
        {
            "kind": "stage_output",
            "stage": "sequential_debate",
            "title": "Sequential per-finding debate",
            "subtitle": "open → challenge → resolve for each finding",
            "body": f"{len(findings)} finding(s) after dedup. Cap: {max_findings if max_findings is not None else 'none'}.",
        },
    )

    vote_rows_by_fid: dict[str, list[dict]] = {f["id"]: [] for f in findings}
    graph_steps: list[dict] = []
    graph_steps.append({"id": "n0", "label": "aggregate done", "finding_id": "", "role": ""})
    graph_counter = 1

    to_debate = findings[: max_findings if max_findings is not None else len(findings)]
    write_debate_graph_mermaid(work_dir, graph_steps)
    write_debate_graph_excalidraw(work_dir, graph_steps)
    debate_track: list[dict] = []

    for fi, finding in enumerate(to_debate):
        fid = finding["id"]
        prior_lines: list[str] = []

        for turn_idx, role in enumerate(TURN_ROLES):
            slot = slot_for_turn(turn_idx, num_agents)
            persona = persona_for_slot(slot)
            agent_name = persona["display_name"]
            ws = workspaces[slot] if slot < len(workspaces) else workspaces[0]
            prior_summary = "\n".join(prior_lines) if prior_lines else ""

            prompt = build_turn_prompt(finding, role, prior_summary, persona)
            out_path = turns_dir / f"{fid}_{turn_idx}_{role}.txt"
            step_id = f"n{graph_counter}"
            graph_counter += 1
            label = f"{fid} · {role} · {persona['short']}"
            graph_steps.append(
                {
                    "id": step_id,
                    "label": label,
                    "finding_id": fid,
                    "role": role,
                    "persona": persona["key"],
                }
            )
            debate_track.append(
                {
                    "finding_id": fid,
                    "role": role,
                    "agent_name": agent_name,
                    "persona_key": persona["key"],
                    "slot": slot,
                    "state": "live",
                    "step_id": step_id,
                }
            )

            write_status(
                status_file,
                {
                    "phase": "sequential_debate",
                    "target": target,
                    "debate_mode": "sequential",
                    "current_finding": fid,
                    "current_turn": role,
                    "current_turn_index": turn_idx,
                    "findings_total": len(to_debate),
                    "finding_index": fi,
                    "debate_track": debate_track + [],
                    "agents": [{"name": agent_name, "status": "running", "slot": slot}],
                },
            )

            runner = AgentRunner(
                slot,
                ws,
                prompt,
                out_path,
                timeout,
                work_dir=work_dir,
                display_name=agent_name,
                persona_key=persona["key"],
                stream_meta={
                    "phase": "debate_turn",
                    "finding_id": fid,
                    "role": role,
                    "persona": persona["key"],
                },
            )
            runner.run()

            parsed = runner.get_result()
            record = {
                "finding_id": fid,
                "role": role,
                "agent_slot": slot,
                "agent_name": agent_name,
                "persona_key": persona["key"],
                "status": runner.status,
                "output_path": str(out_path),
                "parsed": parsed,
            }
            _append_debate_turn_jsonl(work_dir, record)

            vote = "abstain"
            comment = ""
            stance = ""
            if isinstance(parsed, dict):
                vote = str(parsed.get("vote", "abstain")).lower()
                if vote not in ("agree", "disagree"):
                    vote = "abstain"
                comment = str(parsed.get("rationale", ""))[:500]
                stance = str(parsed.get("stance", ""))[:300]
                prior_lines.append(f"{agent_name} ({role}): [{vote}] {stance}")

            if runner.status == "completed" and vote in ("agree", "disagree"):
                vote_rows_by_fid[fid].append(
                    {
                        "agent": f"{agent_name} ({role})",
                        "vote": vote,
                        "comment": comment,
                        "role": role,
                    }
                )

            debate_track[-1]["state"] = "done" if runner.status == "completed" else runner.status

            append_event(
                work_dir,
                {
                    "kind": "stage_output",
                    "stage": "debate_turn",
                    "title": label,
                    "subtitle": f"Status: {runner.status}",
                    "body": (stance or comment or log_tail_bytes(out_path, 4000))[:8000],
                },
            )

            write_debate_graph_mermaid(work_dir, graph_steps)
            write_debate_graph_excalidraw(work_dir, graph_steps)

        # findings not in to_debate get no rows — tally will treat as empty

    # Remaining findings (if capped): no sequential votes; legacy empty
    write_status(
        status_file,
        {
            "phase": "sequential_debate_done",
            "target": target,
            "debate_mode": "sequential",
            "findings_debated": len(to_debate),
            "debate_track": debate_track,
        },
    )

    append_event(
        work_dir,
        {
            "kind": "stage_output",
            "stage": "sequential_debate_done",
            "title": "Sequential rounds complete",
            "subtitle": f"Debated {len(to_debate)} finding(s), {len(TURN_ROLES)} turns each",
            "body": "Votes recorded per turn in debate_turns.jsonl. Graphs updated.",
        },
    )

    return vote_rows_by_fid, graph_steps


def phase_tally(
    findings: list[dict],
    vote_agents: list[AgentRunner],
    eval_agents: list[AgentRunner],
    work_dir: Path,
    *,
    sequential_votes: dict[str, list[dict]] | None = None,
) -> tuple[int, str, list[dict]]:
    """Phase 5: Tally votes and compute score."""
    print("\n=== PHASE 5: Tally ===")

    append_event(work_dir, {
        "kind": "stage_output",
        "stage": "tally_start",
        "title": "Tallying",
        "subtitle": "Computing consensus and score",
        "body": f"Parsing votes for {len(findings)} findings.",
    })

    all_votes: dict[str, list[dict]] = {}
    for f in findings:
        all_votes[f["id"]] = []

    if sequential_votes is not None:
        for fid, rows in sequential_votes.items():
            if fid in all_votes:
                all_votes[fid] = list(rows)
    else:
        for agent in vote_agents:
            result = agent.get_result()
            if not result:
                print(f"  [{agent.name}] No parseable votes, skipping")
                continue

            votes = result.get("votes", [])
            print(f"  [{agent.name}] {len(votes)} votes")

            for v in votes:
                fid = v.get("id", "")
                if fid in all_votes:
                    all_votes[fid].append({
                        "agent": agent.name,
                        "vote": v.get("vote", "abstain"),
                        "comment": v.get("comment", ""),
                    })

    use_per_finding_n = sequential_votes is not None
    legacy_num_voters = sum(1 for a in vote_agents if a.status == "completed")
    if legacy_num_voters == 0:
        legacy_num_voters = 1

    for f in findings:
        fid = f["id"]
        votes = all_votes.get(fid, [])
        agrees = sum(1 for v in votes if v["vote"] == "agree")
        disagrees = sum(1 for v in votes if v["vote"] == "disagree")
        num_voters = len(votes) if use_per_finding_n else legacy_num_voters
        if num_voters == 0:
            num_voters = 1
        f["agrees"] = agrees
        f["disagrees"] = disagrees
        f["vote_ratio"] = f"{agrees}/{num_voters}"
        f["dissent_comments"] = [
            f"{v['agent']}: {v.get('comment', '')}" for v in votes
            if v["vote"] == "disagree" and v.get("comment")
        ]

    score = 100
    for f in findings:
        sev = f.get("severity", "minor")
        agrees = f["agrees"]
        num_voters = len(all_votes.get(f["id"], [])) if use_per_finding_n else legacy_num_voters
        if num_voters == 0:
            num_voters = 1

        if agrees == num_voters and num_voters >= 2:
            pen = {"critical": 15, "major": 8, "minor": 3}.get(sev, 3)
        elif agrees >= 2:
            pen = {"critical": 10, "major": 5, "minor": 2}.get(sev, 2)
        elif agrees >= 1:
            pen = 1
        else:
            pen = 0

        f["penalty"] = pen
        score -= pen

    score = max(0, min(100, score))

    if score >= 90:
        rating = "Excellent"
    elif score >= 70:
        rating = "Good"
    elif score >= 50:
        rating = "Needs Work"
    else:
        rating = "Significant Issues"

    print(f"  Score: {score}/100 ({rating})")
    return score, rating, findings


def append_tally_event(work_dir: Path, score: int, rating: str, findings: list[dict]):
    append_event(work_dir, {
        "kind": "stage_output",
        "stage": "tally_done",
        "title": "Verdict",
        "subtitle": f"Score {score}/100 — {rating}",
        "body": f"Tallied {len(findings)} findings after consensus weighting.",
    })


def _vote_denom(f: dict, vote_agents: list[AgentRunner]) -> int:
    try:
        part = str(f.get("vote_ratio", "0/1")).split("/")[1]
        return max(1, int(part))
    except (IndexError, ValueError):
        return max(1, sum(1 for a in vote_agents if a.status == "completed"))


def generate_report(
    scan: dict,
    score: int,
    rating: str,
    findings: list[dict],
    eval_agents: list[AgentRunner],
    vote_agents: list[AgentRunner],
    *,
    debate_mode: str = "legacy",
) -> str:
    """Generate the final markdown report."""
    lines = []
    lines.append(f"# Code Debate Report: {scan.get('project_name', 'Unknown')}")
    lines.append("")
    lines.append("## Project Overview")
    lines.append(f"- **Purpose:** {scan.get('purpose', 'N/A')}")
    lines.append(f"- **Tech Stack:** {', '.join(scan.get('tech_stack', []))}")
    lines.append(f"- **Architecture:** {scan.get('architecture', 'N/A')}")
    lines.append(f"- **Key Files:** {', '.join(scan.get('key_files', []))}")
    lines.append(f"- **Estimated Size:** {scan.get('loc_estimate', 'N/A')}")
    lines.append("")
    lines.append(f"## Overall Score: {score}/100 -- {rating}")
    lines.append("")

    if debate_mode == "sequential":
        lines.append("## Voting method")
        lines.append(
            "Per-finding sequential debate: **open** → **challenge** → **resolve** "
            "(one agent turn each). Raw turns: `debate_turns.jsonl`; graphs: "
            "`debate_graph.mermaid`, `debate_graph.excalidraw.json`."
        )
        lines.append("")

    # Group findings by vote consensus (denominator may differ per finding in sequential mode)
    unanimous = [
        f for f in findings
        if f["agrees"] >= 2 and f["agrees"] == _vote_denom(f, vote_agents)
    ]
    majority = [
        f for f in findings
        if 1 < f["agrees"] < _vote_denom(f, vote_agents) and _vote_denom(f, vote_agents) > 2
    ]
    minority = [f for f in findings if f["agrees"] == 1]
    rejected = [f for f in findings if f["agrees"] == 0]

    def findings_table(items, include_dissent=False):
        if not items:
            lines.append("*None*\n")
            return
        if include_dissent:
            lines.append("| ID | Sev | Category | Path | Description | Dissent |")
            lines.append("|----|-----|----------|------|-------------|---------|")
            for f in items:
                dissent = "; ".join(f.get("dissent_comments", [])) or "-"
                lines.append(f"| {f['id']} | {f['severity']} | {f['category']} | `{f['path']}` | {f['description']} | {dissent} |")
        else:
            lines.append("| ID | Sev | Category | Path | Description |")
            lines.append("|----|-----|----------|------|-------------|")
            for f in items:
                lines.append(f"| {f['id']} | {f['severity']} | {f['category']} | `{f['path']}` | {f['description']} |")
        lines.append("")

    lines.append("## Unanimous Findings (all votes agree) -- High Confidence")
    findings_table(unanimous)

    if majority:
        lines.append(f"## Majority Findings -- Medium Confidence")
        findings_table(majority)

    lines.append("## Controversial Findings (1 vote) -- Low Confidence")
    findings_table(minority, include_dissent=True)

    lines.append("## Rejected Findings (0 votes)")
    if rejected:
        for f in rejected:
            lines.append(f"- ~~{f['id']}: [{f['category']}] `{f['path']}` — {f['description']}~~")
    else:
        lines.append("*None*")
    lines.append("")

    # Model perspectives
    lines.append("## Model Perspectives")

    for i, ea in enumerate(eval_agents):
        eval_result = ea.get_result()
        eval_count = len(eval_result.get("findings", [])) if eval_result else 0

        vote_count = 0
        agree_count = 0
        if i < len(vote_agents):
            va = vote_agents[i]
            vr = va.get_result()
            if vr:
                votes = vr.get("votes", [])
                vote_count = len(votes)
                agree_count = sum(1 for v in votes if v.get("vote") == "agree")

        status_str = f"Raised {eval_count} findings"
        if vote_count:
            status_str += f", agreed with {agree_count}/{vote_count} voting items"
        if ea.status != "completed":
            status_str = f"FAILED ({ea.error})"

        lines.append(f"- **{ea.name}:** {status_str}")

    lines.append("")
    lines.append("## Methodology")
    n = len(eval_agents)
    lines.append(
        "Three fixed personas (cycled if more than three agents): **Software engineer** (systems & correctness), "
        "**UI/UX developer** (craft & accessibility), **Product manager** (shipping & outcomes). "
        "Each uses role-specific intent and reasoning steps in prompts."
    )
    lines.append(
        f"{n} parallel Cursor Agent CLI runs (default model — no explicit `--model`) "
        "independently evaluated this codebase,"
    )
    if debate_mode == "sequential":
        lines.append(
            "then each aggregated finding was debated in three sequential turns before tally."
        )
    else:
        lines.append("then agents voted on all aggregated findings in parallel.")
    lines.append("Score deducts by severity weighted by vote consensus.")
    lines.append(f"\n*Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}*")

    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def _configure_stdio_utf8():
    """Prevent UnicodeEncodeError when printing reports on Windows (cp1252)."""
    for stream in (getattr(sys, "stdout", None), getattr(sys, "stderr", None)):
        if stream is None:
            continue
        reconf = getattr(stream, "reconfigure", None)
        if callable(reconf):
            try:
                reconf(encoding="utf-8", errors="replace")
            except (OSError, ValueError):
                pass


def execute_debate(
    target: Path,
    work_dir: Path,
    num_agents: int,
    timeout: int,
    *,
    print_banner: bool = True,
    print_report_stdout: bool = True,
    debate_mode: str = "sequential",
    max_findings_debate: int | None = None,
    improvement_plan: bool = False,
    use_git_worktrees: bool = False,
) -> int:
    """
    Run the full debate pipeline. Returns 0 on success, 1 on fatal failure.
    Writes artifacts under work_dir (status, events.jsonl, report, results).
    debate_mode: "sequential" (per-finding debate turns) or "legacy" (parallel bulk vote).
    improvement_plan: if True, run three persona passes appending improvement-plan.md.
    use_git_worktrees: if True and target is in a git repo, extra agents use detached worktrees.
    """
    get_agent_paths()

    work_dir.mkdir(parents=True, exist_ok=True)
    status_file = work_dir / "status.json"
    report_file = work_dir / "debate-report.md"
    results_file = work_dir / "results.json"

    if (work_dir / "events.jsonl").exists():
        (work_dir / "events.jsonl").unlink()
    if (work_dir / "stream.jsonl").exists():
        (work_dir / "stream.jsonl").unlink()

    start = time.time()

    if print_banner:
        print("=" * 60)
        print("  CODE DEBATE")
        print("=" * 60)
        print(f"  Target:  {target}")
        print(f"  Agents:  {num_agents} (CLI default model)")
        print(f"  Output:  {work_dir}")
        print(f"  Timeout: {timeout}s per agent")
        print("=" * 60)

    workspaces, git_root, wt_cleanup = create_parallel_workspaces(
        target, work_dir, num_agents, use_git_worktrees
    )

    def fin(code: int) -> int:
        cleanup_git_worktrees(git_root, wt_cleanup)
        return code

    write_status(
        status_file,
        {
            "phase": "starting",
            "target": str(target),
            "num_agents": num_agents,
            "debate_mode": debate_mode,
            "improvement_plan": improvement_plan,
            "use_git_worktrees": use_git_worktrees,
        },
    )
    append_event(work_dir, {
        "kind": "stage_output",
        "stage": "starting",
        "title": "The hall is seated",
        "subtitle": "Debate session opened",
        "body": f"Target: {target}\nPersonas: SWE / UX / PM (cycled if agents > 3). "
                f"Git worktrees: {bool(use_git_worktrees)}. Improvement plan: {bool(improvement_plan)}.",
    })

    meta_path = work_dir / "meta.json"
    if meta_path.is_file():
        try:
            meta_blob = json.loads(meta_path.read_text(encoding="utf-8"))
            guided = meta_blob.get("guided")
            if isinstance(guided, dict) and guided:
                append_event(
                    work_dir,
                    {
                        "kind": "stage_output",
                        "stage": "guided_intent",
                        "title": "Guided plan layer",
                        "subtitle": (guided.get("query_rephrase") or "User intent")[:240],
                        "body": json.dumps(
                            {
                                "user_query": guided.get("user_query"),
                                "focus_points": guided.get("focus_points"),
                                "internal_rationale": guided.get("internal_rationale"),
                            },
                            ensure_ascii=False,
                            indent=2,
                        )[:12000],
                    },
                )
        except (OSError, json.JSONDecodeError):
            pass

    eval_agents = phase_scan_evaluate(num_agents, workspaces, work_dir, timeout, status_file)

    succeeded = [a for a in eval_agents if a.status == "completed"]
    if not succeeded:
        print("\nFATAL: All agents failed in scan/evaluate phase.")
        print("Diagnostics:")
        for a in eval_agents:
            print(f"  {a.name}: {a.error}")
            out_text = a.output_path.read_text(encoding="utf-8", errors="replace").strip()
            if out_text:
                print(f"    Output: {out_text[:300]}")
        write_status(status_file, {
            "phase": "failed",
            "target": str(target),
            "num_agents": num_agents,
            "agents": [a.to_dict() for a in eval_agents],
        })
        append_event(work_dir, {
            "kind": "stage_output",
            "stage": "failed",
            "title": "Session adjourned — failure",
            "subtitle": "All debaters failed in opening session",
            "body": "\n".join(f"{a.name}: {a.error}" for a in eval_agents),
            "agent_logs": {a.name: log_tail_bytes(a.output_path) for a in eval_agents},
        })
        return fin(1)

    scan, findings = phase_aggregate(
        eval_agents, work_dir, status_file, str(target), num_agents,
    )

    if not findings:
        print("\nNo findings to vote on. Generating report with clean bill of health.")
        report = generate_report(
            scan, 100, "Excellent", [], eval_agents, [], debate_mode=debate_mode,
        )
        report_file.write_text(report, encoding="utf-8")
        write_status(status_file, {
            "phase": "complete",
            "clean_bill": True,
            "score": 100,
            "rating": "Excellent",
            "target": str(target),
            "num_agents": num_agents,
            "agents": [a.to_dict() for a in eval_agents],
        })
        append_event(work_dir, {
            "kind": "stage_output",
            "stage": "complete",
            "title": "Unanimous: clean bill",
            "subtitle": "No findings to debate",
            "body": "Report written with score 100 / Excellent.",
        })
        print(f"\nReport: {report_file}")
        if print_report_stdout:
            print("\n" + report)
        return fin(0)

    sequential_vote_map: dict[str, list[dict]] | None = None
    vote_agents: list[AgentRunner] = []

    if debate_mode == "sequential":
        sequential_vote_map, _ = phase_sequential_findings_debate(
            num_agents,
            workspaces,
            findings,
            work_dir,
            timeout,
            status_file,
            str(target),
            max_findings_debate,
        )
    else:
        vote_agents = phase_vote(
            num_agents, workspaces, findings, work_dir, timeout, status_file,
        )

    score, rating, findings = phase_tally(
        findings,
        vote_agents,
        eval_agents,
        work_dir,
        sequential_votes=sequential_vote_map,
    )
    append_tally_event(work_dir, score, rating, findings)

    write_status(status_file, {
        "phase": "tally_done",
        "target": str(target),
        "num_agents": num_agents,
        "debate_mode": debate_mode,
        "score": score,
        "rating": rating,
        "findings_count": len(findings),
        "eval_agents": [a.to_dict() for a in eval_agents],
        "vote_agents": [a.to_dict() for a in vote_agents],
    })

    report = generate_report(
        scan,
        score,
        rating,
        findings,
        eval_agents,
        vote_agents,
        debate_mode=debate_mode,
    )
    report_file.write_text(report, encoding="utf-8")

    results = {
        "target": str(target),
        "num_agents": num_agents,
        "debate_mode": debate_mode,
        "max_findings_debate": max_findings_debate,
        "improvement_plan": improvement_plan,
        "use_git_worktrees": use_git_worktrees,
        "personas": [p["key"] for p in DEBATER_PERSONAS],
        "score": score,
        "rating": rating,
        "scan": scan,
        "findings": findings,
        "eval_agents": [a.to_dict() for a in eval_agents],
        "vote_agents": [a.to_dict() for a in vote_agents],
        "elapsed": round(time.time() - start, 1),
        "improvement_plan_path": None,
    }
    results_file.write_text(json.dumps(results, indent=2), encoding="utf-8")

    if improvement_plan:
        phase_improvement_plan(
            work_dir,
            workspaces[0],
            timeout,
            status_file,
            str(target),
            scan,
            findings,
            score,
            rating,
        )
        results["improvement_plan_path"] = str(work_dir / "improvement-plan.md")
        results_file.write_text(json.dumps(results, indent=2), encoding="utf-8")
        report_file.write_text(
            report
            + "\n\n## Improvement plan\n\n"
            + "Multi-persona roadmap (engineering, UX, product): see **improvement-plan.md** in this run folder.\n",
            encoding="utf-8",
        )

    write_status(status_file, {
        "phase": "complete",
        "target": str(target),
        "num_agents": num_agents,
        "debate_mode": debate_mode,
        "score": score,
        "rating": rating,
        "findings_deduped": len(findings),
        "eval_agents": [a.to_dict() for a in eval_agents],
        "vote_agents": [a.to_dict() for a in vote_agents],
    })

    append_event(work_dir, {
        "kind": "stage_output",
        "stage": "complete",
        "title": "Session closed",
        "subtitle": f"Final score {score}/100 — {rating}",
        "body": "Full report and results.json are stored in this run folder.",
    })

    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"  DEBATE COMPLETE — Score: {score}/100 ({rating})")
    print(f"  Time: {elapsed:.0f}s")
    print(f"  Report: {report_file}")
    print(f"  Results: {results_file}")
    print(f"{'=' * 60}")

    if print_report_stdout:
        print("\n" + report)

    return fin(0)


def main():
    _configure_stdio_utf8()

    parser = argparse.ArgumentParser(description="Multi-agent code debate")
    parser.add_argument("target", help="Directory to evaluate")
    parser.add_argument("--agents", type=int, default=NUM_AGENTS,
                        help=f"Parallel agent processes (default: {NUM_AGENTS}, min 2)")
    parser.add_argument("--timeout", type=int, default=300,
                        help="Timeout per agent in seconds (default: 300)")
    parser.add_argument("--output-dir", default=None,
                        help="Directory for output files (default: <target>/.debate/)")
    parser.add_argument("--no-ui", action="store_true",
                        help="Do not start local dashboard or open a browser")
    parser.add_argument("--ui-port", type=int, default=0,
                        help="Dashboard port (0 = OS-assigned, localhost only)")
    parser.add_argument(
        "--hall-url",
        default=os.environ.get("DEBATE_HALL_URL", "").strip(),
        help="If set, POST a new run to this Debate Hall (e.g. http://127.0.0.1:8765) and exit",
    )
    parser.add_argument(
        "--debate-mode",
        choices=["sequential", "legacy"],
        default="sequential",
        help="sequential: open/challenge/resolve per finding; legacy: parallel bulk vote",
    )
    parser.add_argument(
        "--max-findings-debate",
        type=int,
        default=None,
        help="Cap how many findings get sequential debate rounds (default: all)",
    )
    parser.add_argument(
        "--improvement-plan",
        action="store_true",
        help="After scoring, run SWE → UX → PM passes appending improvement-plan.md",
    )
    parser.add_argument(
        "--git-worktrees",
        action="store_true",
        help="If target is in a git repo, use detached worktrees for agents 2..N (same commit)",
    )
    args = parser.parse_args()

    target = Path(args.target).resolve()
    if not target.is_dir():
        print(f"ERROR: {target} is not a directory")
        sys.exit(1)

    try:
        get_agent_paths()
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    num_agents = args.agents
    if num_agents < 2:
        print("ERROR: need at least 2 parallel agents for a debate")
        sys.exit(1)

    if args.hall_url:
        import urllib.error
        import urllib.request

        payload = json.dumps({
            "target": str(target),
            "agents": num_agents,
            "timeout": args.timeout,
            "debate_mode": args.debate_mode,
            "max_findings_debate": args.max_findings_debate,
            "improvement_plan": args.improvement_plan,
            "use_git_worktrees": args.git_worktrees,
        }).encode("utf-8")
        req = urllib.request.Request(
            args.hall_url.rstrip("/") + "/api/runs",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            print(f"[Hall] Queued run {data.get('run_id')} — open {args.hall_url} to watch.")
            sys.exit(0)
        except urllib.error.URLError as e:
            print(f"ERROR: Could not reach Debate Hall at {args.hall_url}: {e}")
            print("Start the hall: python hall_server.py")
            sys.exit(1)

    work_dir = Path(args.output_dir) if args.output_dir else target / ".debate"

    if not args.no_ui:
        try:
            _, ui_url = start_ui_server(work_dir, port=args.ui_port)
            print(f"\n[UI] Dashboard: {ui_url} (tab closes when this process exits — use hall_server.py to keep a permanent hall)")
            webbrowser.open(ui_url)
        except OSError as e:
            print(f"\n[UI] Could not start dashboard: {e}")

    code = execute_debate(
        target,
        work_dir,
        num_agents,
        args.timeout,
        debate_mode=args.debate_mode,
        max_findings_debate=args.max_findings_debate,
        improvement_plan=args.improvement_plan,
        use_git_worktrees=args.git_worktrees,
    )
    sys.exit(code)


if __name__ == "__main__":
    main()
