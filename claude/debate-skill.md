<!-- Hub mirror: copied to %USERPROFILE%\.claude\rules\debate-skill.md by scripts\Install-AgentSkillsEnv.ps1 -->

# Debate skill (Claude Code and other agents)

Use this when the user says **`/debate`**, **`/debate <directory>`**, or asks to run the multi-agent code debate / Debate Hall.

## Canonical location (single source of truth)

Everything lives under **`AGENT_SKILLS_ROOT`** (this machine: `C:\Users\rentk\mihir\agent-skills` when the env var is set):

| What | Path |
|------|------|
| **Skill instructions** | `%AGENT_SKILLS_ROOT%\cursor\skills\debate\SKILL.md` |
| **Orchestrator** | `%AGENT_SKILLS_ROOT%\cursor\skills\debate\debate.py` |
| **Debate Hall server** | `%AGENT_SKILLS_ROOT%\cursor\skills\debate\hall_server.py` |
| **Hall UI (static files)** | `%AGENT_SKILLS_ROOT%\cursor\skills\debate\hall_web\` |
| **Per-run ephemeral UI** | `%AGENT_SKILLS_ROOT%\cursor\skills\debate\web\` |
| **Guided planner** | `%AGENT_SKILLS_ROOT%\cursor\skills\debate\debate_planner.py` |
| **Launcher (GUI)** | `%AGENT_SKILLS_ROOT%\cursor\skills\debate\Start-DebateHall.ps1`, `start_debate_hall.py` |

Do **not** maintain a second copy of this skill outside the hub; Cursor discovers the same tree via the junction `%USERPROFILE%\.cursor\skills` → `%AGENT_SKILLS_ROOT%\cursor\skills`.

## Commands (PowerShell)

```powershell
# Run debate (read SKILL.md for flags)
python "$env:AGENT_SKILLS_ROOT\cursor\skills\debate\debate.py" "C:\path\to\repo"

# Persistent hall + UI
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:AGENT_SKILLS_ROOT\cursor\skills\debate\Start-DebateHall.ps1"
```

Hall URL when running locally: **http://127.0.0.1:8765/** (default port).

**Run folders:** `<target>/.debate/runs/<uuid>/` (plus `debate_hall_data/run_registry.jsonl`). Legacy runs may still sit under `debate_hall_data/runs/`.

**Stop agents without closing the hall:** `POST http://127.0.0.1:8765/api/hall/stop-agents` with body `{}` (loopback only), or the **Stop agents** button in the UI. See **`cursor/skills/debate-shutdown/SKILL.md`**.

**Hall UI (summary):** Path + optional motion/intent → **Start run** (planner when intent is set). **`GET /api/target-inspect?path=`** drives worktree defaults. **Improvement plan** defaults on. Output: stream, **improvement-plan.md** preview, live Mermaid.

## Verify hub

`powershell -NoProfile -ExecutionPolicy Bypass -File "%AGENT_SKILLS_ROOT%\scripts\Verify-AgentSkillsEnv.ps1"`
