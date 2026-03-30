"""
Guided run planning: spawn dedicated Cursor agents to turn a natural-language
goal into focus points + internal run parameters (mode, worktrees, improvement plan, caps).

Used by Debate Hall POST /api/plan-run/start. Not imported from debate.py to avoid cycles.
"""

from __future__ import annotations

import json
from pathlib import Path

# Import orchestrator pieces (debate.py does not import this module).
from debate import AgentRunner, extract_json_from_text
from _utils import is_git_repo


def _clamp_plan(raw: dict, target: Path) -> dict:
    """Normalize strategist JSON to safe API values."""
    mode = str(raw.get("debate_mode", "sequential")).lower()
    if mode not in ("sequential", "legacy"):
        mode = "sequential"

    n = 3

    t = int(raw.get("timeout", raw.get("timeout_sec", 300)))
    t = max(60, min(3600, t))

    max_fd = raw.get("max_findings_debate")
    max_findings = None
    if max_fd is not None and str(max_fd).strip() != "":
        try:
            max_findings = max(1, int(max_fd))
        except (TypeError, ValueError):
            max_findings = None

    git_ok = _is_git_repo(target)
    use_wt = bool(raw.get("use_git_worktrees", False))
    if use_wt and not git_ok:
        use_wt = False

    focus = raw.get("focus_points")
    if not isinstance(focus, list):
        focus = []
    focus = [str(x).strip() for x in focus if str(x).strip()][:12]

    return {
        "focus_points": focus,
        "query_rephrase": str(raw.get("query_rephrase", "")).strip()[:500],
        "debate_mode": mode,
        "improvement_plan": bool(raw.get("improvement_plan", False)),
        "use_git_worktrees": use_wt,
        "max_findings_debate": max_findings,
        "num_agents": n,
        "timeout": t,
        "internal_rationale": str(raw.get("internal_rationale", "")).strip()[:4000],
        "target_is_git": git_ok,
    }


def _defaults_for_query(query: str, target: Path) -> dict:
    q = (query or "").lower()
    improvement = any(
        k in q
        for k in (
            "roadmap",
            "plan",
            "improve",
            "next step",
            "execution",
            "priorit",
            "sprint",
        )
    )
    worktrees = _is_git_repo(target) and any(
        k in q for k in ("isolate", "parallel", "worktree", "concurrent", "race", "clean tree")
    )
    legacy = any(k in q for k in ("fast", "quick", "cheap", "legacy", "parallel vote"))
    cap = None
    if any(k in q for k in ("quick", "sample", "top 5", "five findings")):
        cap = 5
    if "max " in q:
        import re

        m = re.search(r"max\s+(\d+)\s+finding", q)
        if m:
            cap = int(m.group(1))
    return _clamp_plan(
        {
            "focus_points": [
                "Align review with stated user goal",
                "Surface security and correctness risks",
                "Check UX/product impact where relevant",
            ],
            "query_rephrase": query[:240] if query else "",
            "debate_mode": "legacy" if legacy else "sequential",
            "improvement_plan": improvement,
            "use_git_worktrees": worktrees,
            "max_findings_debate": cap,
            "num_agents": 3,
            "timeout": 300,
            "internal_rationale": "Heuristic fallback (planner agent did not return JSON).",
        },
        target,
    )


def _agent_json(runner: AgentRunner) -> dict | None:
    if runner.status != "completed" or not runner.output_path.is_file():
        return None
    text = runner.output_path.read_text(encoding="utf-8", errors="replace")
    data = extract_json_from_text(text)
    return data if isinstance(data, dict) else None


def run_guided_plan(
    user_query: str,
    target: Path,
    *,
    timeout_per_agent: int = 180,
    scratch_dir: Path | None = None,
) -> dict:
    """
    Run two planner agents (focus analyst → run strategist) and return a unified plan dict.
    Falls back to heuristics if agents fail to produce JSON.
    """
    query = (user_query or "").strip()
    if not query:
        raise ValueError("empty query")

    target = target.resolve()
    if not target.is_dir():
        raise ValueError("target is not a directory")

    ws = str(target)
    trace: list[dict] = []

    if scratch_dir is None:
        scratch_dir = target
    scratch_dir.mkdir(parents=True, exist_ok=True)
    out_focus = scratch_dir / "_planner_focus.txt"
    out_strat = scratch_dir / "_planner_strategist.txt"

    # --- Agent 1: focus analyst ---
    focus_prompt = (
        "You are Planner Agent A (Focus Analyst) in a code-review debate system.\n"
        "The user described what they care about. Extract concrete review dimensions.\n\n"
        "USER GOAL:\n\"\"\"\n"
        + query
        + "\n\"\"\"\n\n"
        "Reply with ONLY a JSON object inside a markdown ```json code fence. Schema:\n"
        '{"focus_points":["string", ...], "query_rephrase": "one line", '
        '"risk_hints": ["optional strings"]}\n'
        "Use 3–10 focus_points (specific, actionable lenses).\n"
        "No prose outside the fence."
    )

    r1 = AgentRunner(
        0,
        ws,
        focus_prompt,
        out_focus,
        timeout_per_agent,
        display_name="Planner: Focus analyst",
        persona_key="planner_focus",
    )
    r1.run()
    trace.append(
        {
            "role": "planner_focus",
            "name": r1.name,
            "status": r1.status,
            "error": r1.error,
            "output": str(out_focus),
        }
    )

    focus_data = _agent_json(r1) or {}
    focus_points = focus_data.get("focus_points")
    if not isinstance(focus_points, list) or not focus_points:
        focus_points = [
            "Map stated goal to concrete code areas",
            "Security and correctness",
            "Maintainability and delivery risk",
        ]
    focus_points = [str(x).strip() for x in focus_points if str(x).strip()][:12]
    rephrase = str(focus_data.get("query_rephrase", "")).strip() or query[:200]
    risk_hints = focus_data.get("risk_hints")
    if not isinstance(risk_hints, list):
        risk_hints = []

    git_here = _is_git_repo(target)

    # --- Agent 2: run strategist (internal parameters) ---
    strat_prompt = (
        "You are Planner Agent B (Run Strategist). Configure the automated debate run.\n"
        f"Target directory (workspace): {ws}\n"
        f"Resolved as git working tree: {git_here}\n\n"
        "USER GOAL:\n\"\"\"\n"
        + query
        + "\n\"\"\"\n\n"
        "FOCUS POINTS (from Planner A):\n"
        + json.dumps(focus_points, ensure_ascii=False, indent=2)
        + "\n\n"
        "RISK HINTS:\n"
        + json.dumps(risk_hints, ensure_ascii=False, indent=2)
        + "\n\n"
        "Choose internal parameters. Reply with ONLY ```json ... ``` containing:\n"
        "{\n"
        '  "focus_points": [...]  // copy or refine Planner A list,\n'
        '  "query_rephrase": "short",\n'
        '  "debate_mode": "sequential" | "legacy",\n'
        '  "improvement_plan": true/false,\n'
        '  "use_git_worktrees": true/false,  // true only if git AND isolation helps\n'
        '  "max_findings_debate": null or integer,\n'
        '  "num_agents": 3,\n'
        '  "timeout": seconds 120-900,\n'
        '  "internal_rationale": "why these settings (2-6 sentences)"\n'
        "}\n"
        "Rules: sequential unless user explicitly wants fastest bulk legacy vote. "
        "improvement_plan true when user wants roadmap / next steps / team handoff. "
        "use_git_worktrees true when parallel isolated trees help (git repo required). "
        "Cap max_findings_debate for huge scope or quick triage requests.\n"
        "num_agents must always be 3 (fixed debaters).\n"
        "No text outside the JSON fence."
    )

    r2 = AgentRunner(
        1,
        ws,
        strat_prompt,
        out_strat,
        timeout_per_agent,
        display_name="Planner: Run strategist",
        persona_key="planner_strategy",
    )
    r2.run()
    trace.append(
        {
            "role": "planner_strategy",
            "name": r2.name,
            "status": r2.status,
            "error": r2.error,
            "output": str(out_strat),
        }
    )

    merged = _agent_json(r2)
    if not merged:
        plan = _defaults_for_query(query, target)
        plan["internal_rationale"] = (
            (plan.get("internal_rationale") or "")
            + " Strategist agent did not return valid JSON."
        ).strip()
    else:
        plan = _clamp_plan(merged, target)

    plan["query_rephrase"] = plan.get("query_rephrase") or rephrase
    if not plan.get("focus_points"):
        plan["focus_points"] = focus_points

    plan["user_query"] = query[:8000]
    plan["planner_version"] = 1
    plan["planner_agents"] = trace

    return plan
