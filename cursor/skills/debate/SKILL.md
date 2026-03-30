---
name: debate
description: >
  Multi-agent code debate: parallel eval, aggregate findings, then sequential
  per-finding debate (open/challenge/resolve) or legacy parallel vote; streams
  agent stdout to stream.jsonl; Debate Hall UI (git inspect, optional intent +
  inline planner, improvement-plan preview) and scored report. Use for /debate
  with a directory path.
---

# Debate (/debate)

## Canonical hub (all agents)

This skill is **only** maintained under **`AGENT_SKILLS_ROOT`** (e.g. `C:\Users\rentk\mihir\agent-skills`). Paths below are relative to **`%AGENT_SKILLS_ROOT%\cursor\skills\debate\`**.

### Standalone installable app (recommended)

The **packaged application** (editable install, console entrypoints, vendored UI reference) lives beside the hub:

- **`mihir/debate-app/`** — see **`debate-app/README.md`**
- After `pip install -e debate-app`: run **`debate-hall`**, **`debate-run`**, or **`debate-hall-gui`**
- **UI refresh** and **ui-design-brain** vendor copy are tracked there; `hall_web/` under this skill is synced from that package for backward compatibility when running `hall_server.py` from the skill folder.

| Artifact | Relative path |
|----------|----------------|
| This file | `SKILL.md` |
| Orchestrator | `debate.py` |
| Debate Hall server | `hall_server.py` |
| **Hall UI (static)** | **`hall_web/`** |
| Ephemeral UI | `web/` |
| Guided planner | `debate_planner.py` |
| Hall launcher | `Start-DebateHall.ps1`, `start_debate_hall.py` |

**Claude Code:** hub file `agent-skills/claude/debate-skill.md` is copied to `~/.claude/rules/debate-skill.md` by **`agent-skills/scripts/Install-AgentSkillsEnv.ps1`**.

## When to use

Apply when the user sends **`/debate <directory-path>`**. The argument is the target directory to evaluate. If no path is given, ask the user for one.

## Where data lives

| Mode | Artifact root |
|------|----------------|
| **CLI** (`debate.py` without `--hall-url`) | `<target>/.debate/` (or `--output-dir`) |
| **Debate Hall** (queued from UI or `debate.py --hall-url`) | `<target>/.debate/runs/<run_id>/` |
| **Hall registry** (maps `run_id` → path) | `%AGENT_SKILLS_ROOT%\cursor\skills\debate\debate_hall_data\run_registry.jsonl` |
| **Legacy Hall runs** (older builds) | `debate_hall_data/runs/<run_id>/` — still listed if present |

Add `.debate/` to the repo’s `.gitignore` if you do not want run metadata committed.

**Agent workspace:** Cursor Agent is still launched with the **repository tree** as `--workspace` (or git worktrees under the run’s `git_worktrees/`), not only the `.debate` folder, so file paths in prompts stay valid.

**Three debaters only:** Alex (SWE), Jordan (UX), Sam (PM). The CLI starts a **new subprocess per phase/turn**; there is no separate “extra” pool of agents—only these three roles, reused logically each step.

**Sequential debate (default):** For each finding, **open → challenge → resolve** runs **strictly one after another**, and **each turn uses exactly one debater** (slot 0, 1, then 2 — never two agents on the same turn). Later turns see **full prior judgments** on that finding (stance + rationale, truncated if huge) so context compounds. The opening scan/eval phase still runs **three agents in parallel** (one per persona).

**Debate wall clock (sequential mode):** Default **600 seconds (10 minutes)** from the start of sequential debate (`--debate-deadline-seconds`, Hall JSON `debate_deadline_seconds`; **0** disables). When the limit hits, **no new turns** are started (current agent may still finish). The run then **tallies partial rounds** and writes **`improvement-plan.md`** via the usual three persona passes **even if `--improvement-plan` was not set**, using a **debate-turn digest** plus findings so the plan reflects whatever was argued before the cap.

## How it works

A Python orchestrator (`debate.py`) plus optional **ephemeral dashboard** (`ui_server.py` + `web/`) or **Debate Hall** (`hall_server.py` + `hall_web/`):

1. **Phase 1+2 — Scan & Evaluate**: Up to **three** parallel Cursor Agent CLI runs (no `--model`; CLI default/auto), producing file-level findings. **Personas** by slot: **Alex — Software Engineer**, **Jordan — UI/UX**, **Sam — Product**. Each gets role-specific **intent**, **logic nodes**, and evaluation lens. Stdout is **streamed** to `stream.jsonl` when a `work_dir` is set.
2. **Phase 3 — Aggregate**: Deduplicate findings across agents.
3. **Phase 4 — Vote / debate** (see `--debate-mode`):
   - **`sequential` (default)**: For each finding, **open → challenge → resolve** (one agent turn each, in order). Each turn writes `debate_turns/<id>_<idx>_<role>.txt` and a row in `debate_turns.jsonl`. Updates `debate_graph.mermaid` and `debate_graph.excalidraw.json` as the run progresses.
   - **`legacy`**: All agents vote on all findings in parallel (`vote_*.txt`), as before.
4. **Phase 5 — Tally & Report**: Votes tallied; score and markdown + JSON written.

**Cost:** Sequential mode runs **3 × (number of findings)** extra agent invocations (plus eval). Use `--max-findings-debate` or `legacy` mode to cap time and API usage.

**Improvement plan (`--improvement-plan`; Hall default **on**, optional off in Advanced):** After scoring, **three extra passes** (SWE → UX → PM) each append a markdown section to **`improvement-plan.md`** in the run folder, using the debate outcome as context (actionable roadmap). The Hall **Output** panel shows a live preview when that file exists.

**Git worktrees (`--git-worktrees`; Hall defaults **on** inside a git repo via target inspect):** If the target path is inside a **git** repository, **agent 1** keeps the original path; **agents 2..N** get **`git worktree add --detach`** checkouts under `work_dir/git_worktrees/slot_*` pinned to **current `HEAD`**. Useful for isolated read-only trees and reproducibility; agents still run in **ask** mode. Requires `git` on `PATH`; worktrees are removed when the run finishes. Non-git targets fall back to a single shared workspace.

## Debate Hall (persistent UI — recommended)

The ephemeral dashboard closes when `debate.py` exits. For a **long-running “debate hall”** that keeps history on disk:

1. **Start the hall (canonical for agents):** use the launcher so the server stays up until **Stop** or the window closes — no bare `Ctrl+C` in a headless terminal.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "$env:AGENT_SKILLS_ROOT\cursor\skills\debate\Start-DebateHall.ps1"
   ```

   Or GUI-only (no terminal): same folder’s `pythonw.exe` next to `python.exe`:

   ```powershell
   pythonw "$env:AGENT_SKILLS_ROOT\cursor\skills\debate\start_debate_hall.py"
   ```

   The `.ps1` script uses **pythonw** and **Start-Process**, so no console window stays open. Optional: `--port 9000`, `--no-autostart`. Headless: run `hall_server.py` with `python` in an existing terminal.

2. Open **http://127.0.0.1:8765/** (or use **Open in browser** in the launcher). New runs write under **`<target>/.debate/runs/<uuid>/`**. The hall UI includes session picker, start form (path + **Browse** via `pick_folder.py` / tkinter), **git target badge** (`GET /api/target-inspect?path=`), **Stop agents** (kills cursor-agent + pickers; hall stays up), stream copy, **debate_track**, **live stream** (`GET /api/runs/<id>/stream?after=<line>`), **improvement plan** preview, **live Mermaid**, **Copy roadmap**. Import `debate_graph.excalidraw.json` at excalidraw.com if needed.

   **Session form:** Optional **Motion / intent** → if set, guided planner runs first, then the debate queues. Empty intent → run starts from **Advanced options** only. **Improvement plan** defaults **on**. **Git worktrees** default **on** in a git repo. `POST /api/runs` accepts `guided` when a plan exists. Planner: `POST /api/plan-run/start` `{"query","target","timeout_per_agent"?}`, poll `GET /api/plan-run/result?token=`. Planner scratch: `debate_hall_data/plan_scratch/<token>/`.

   **Stop agents without closing the hall:** `POST /api/hall/stop-agents` (loopback only), or the **Stop agents** button. **Stop the server:** `POST /api/hall/shutdown`, Ctrl+C on `hall_server.py`, or **Stop server** in the GUI launcher. Subskill: **`debate-shutdown`** (`cursor/skills/debate-shutdown/SKILL.md`).

3. Queue a debate from the browser form, or from another shell:

   ```powershell
   python "$env:AGENT_SKILLS_ROOT\cursor\skills\debate\debate.py" "C:\path\to\repo" --hall-url http://127.0.0.1:8765
   ```

   You can also set **`DEBATE_HALL_URL`** instead of `--hall-url`.

## Browser dashboard (per-run, ephemeral)

On each direct `debate.py` run, unless disabled, the script:

- Starts an HTTP server on **127.0.0.1** only (random port, or `--ui-port`).
- Opens your **default browser** to the dashboard.
- The UI polls `/api/snapshot` for `status.json`, `events`, `stream_tail`, `debate_track`, `debate_graph_mermaid`, log tails (`eval_*`, `vote_*`, `debate_turns/*`), and report preview when ready.

**Frontend assets:** `web/` (`index.html`, `styles.css`, `app.js`) — static files, no bundler. **Hall UI:** `hall_web/`.

**Headless / CI:** pass **`--no-ui`** so no server or browser is started.

## Execution

Run from the skills hub (`AGENT_SKILLS_ROOT`):

**PowerShell**

```powershell
python "$env:AGENT_SKILLS_ROOT\cursor\skills\debate\debate.py" "<TARGET_DIR>"
```

**bash**

```bash
python "${AGENT_SKILLS_ROOT:-$HOME/mihir/agent-skills}/cursor/skills/debate/debate.py" "<TARGET_DIR>"
```

### Options

```
--agents N            Ignored; debater count is fixed at 3 (backward compat)
--timeout N           Seconds per agent invocation (default: 300)
--output-dir PATH     Where to write results (default: <target>/.debate/)
--no-ui               Do not start dashboard or open browser
--ui-port N           Dashboard port (0 = OS-assigned; default 0)
--hall-url URL        POST new run to Debate Hall and exit (or set DEBATE_HALL_URL)
--debate-mode MODE    sequential (default) or legacy
--max-findings-debate N   Cap findings that get sequential rounds (optional)
--improvement-plan        After debate, SWE/UX/PM append sections to improvement-plan.md
--git-worktrees           Use detached git worktrees for agents 2+ when inside a repo
--debate-deadline-seconds SEC   Sequential debate wall clock (default 600; 0=off). On expiry: tally + improvement plan.
```

### Examples

```powershell
python "$env:AGENT_SKILLS_ROOT\cursor\skills\debate\debate.py" C:\path\to\repo

# Fixed dashboard port
python "$env:AGENT_SKILLS_ROOT\cursor\skills\debate\debate.py" C:\path\to\repo --ui-port 8765

# CI / no browser
python "$env:AGENT_SKILLS_ROOT\cursor\skills\debate\debate.py" C:\path\to\repo --no-ui
```

## Output files

Written to `<target>/.debate/` or each hall run folder:

| File | Purpose |
|------|---------|
| `debate-report.md` | Human-readable markdown report with scores and findings tables |
| `results.json` | Machine-readable full results (includes `debate_mode`) |
| `status.json` | Live status, phases, optional `debate_track` for the one-track UI |
| `events.jsonl` | Transcript-style stage events for the hall |
| `stream.jsonl` | NDJSON lines of streamed agent stdout (`chunk`, `phase`, `finding_id`, `role`, `agent`) |
| `eval_0.txt`, … | Raw output from each agent's scan/evaluate phase |
| `vote_0.txt`, … | Raw output from each agent (**legacy** voting phase only) |
| `debate_turns.jsonl` | One row per **sequential** turn (parsed JSON + paths) |
| `debate_turns/*.txt` | Per-turn raw agent logs (sequential mode) |
| `debate_graph.mermaid` | Flowchart source (updated during sequential debate) |
| `debate_graph.excalidraw.json` | Diagram for Excalidraw import |
| `improvement-plan.md` | Optional: persona roadmap sections (with `--improvement-plan`) |

## Monitoring progress

- **Preferred:** use the browser dashboard (auto-opened).
- **Manual:** read `<target>/.debate/status.json` or tail the `eval_*.txt` / `vote_*.txt` files.

## Configuration

Each subprocess is started **without** `--model`, so the Cursor Agent CLI uses its **default / auto** selection for your account. To force a specific model, run `agent` manually or adjust the orchestrator; this skill intentionally does not pass model IDs.

## Scoring

Start at **100**, subtract per finding weighted by vote consensus:

| Votes | Critical | Major | Minor |
|-------|----------|-------|-------|
| Unanimous | -15 | -8 | -3 |
| Majority | -10 | -5 | -2 |
| Minority (1) | -1 | -1 | -1 |
| Rejected (0) | 0 | 0 | 0 |

Ratings: 90+ Excellent, 70-89 Good, 50-69 Needs Work, <50 Significant Issues.

## Error handling

- Agent timeout: killed after timeout, marked as failed, others continue
- Usage limit hit: detected from output, reported in model perspectives
- All agents fail: diagnostic message printed with suggestions
- Partial failure: continues with 2/3 or even 1/3 agents
- UI server bind failure: warning printed; debate continues without dashboard

## Anti-patterns

- Do NOT modify the target codebase (agents use `--mode ask`)
- Do NOT evaluate code yourself — all analysis comes from cursor agents
