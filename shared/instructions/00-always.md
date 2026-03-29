# AGENT_SKILLS_ROOT (all agents)

This folder is loaded via **chat.instructionsFilesLocations** in Cursor, VS Code, and Antigravity.

## Variable

- **`AGENT_SKILLS_ROOT`** — user environment variable pointing at the canonical skills hub (this repo’s `agent-skills` root on this machine: `C:\Users\rentk\mihir\agent-skills`).

## Mandatory

1. **New Cursor personal skills** must be created only at `%AGENT_SKILLS_ROOT%\cursor\skills\<skill-name>\SKILL.md`.  
   `%USERPROFILE%\.cursor\skills` is a junction to that directory; do not maintain a separate duplicate tree.
2. **New shared playbooks / instructions** for multiple agents should live under `%AGENT_SKILLS_ROOT%\shared\` (e.g. this `instructions` folder) or be recorded in the hub **README.md** / **INVENTORY.md**.
3. **Claude Code** user policy is mirrored in `%USERPROFILE%\.claude\rules\agent-skills-root.md`. Official Claude **plugins** stay under `~/.claude/plugins/`.

When answering, prefer citing **`AGENT_SKILLS_ROOT`** so instructions stay portable across tools and shells.

## Debate skill + UI paths (hub only)

- **Skill:** `%AGENT_SKILLS_ROOT%\cursor\skills\debate\SKILL.md`
- **Debate Hall UI (files on disk):** `%AGENT_SKILLS_ROOT%\cursor\skills\debate\hall_web\` — served at runtime as **`http://127.0.0.1:8765/`** (and `/static/...`) when `hall_server.py` or `start_debate_hall.py` is running. Session form: optional intent (planner on **Start**), git inspect + integrated worktree defaults, improvement-plan preview in Output.
- **Ephemeral run UI:** `%AGENT_SKILLS_ROOT%\cursor\skills\debate\web\`
- **Claude Code:** after `Install-AgentSkillsEnv.ps1`, see `%USERPROFILE%\.claude\rules\debate-skill.md` (copy of hub `claude/debate-skill.md`).

## Verify and repair

- **Verify:** `powershell -NoProfile -ExecutionPolicy Bypass -File "%AGENT_SKILLS_ROOT%\scripts\Verify-AgentSkillsEnv.ps1"` (exit 0 = healthy).
- **Repair / new PC:** `powershell -NoProfile -ExecutionPolicy Bypass -File "%AGENT_SKILLS_ROOT%\scripts\Install-AgentSkillsEnv.ps1"` then restart editors.
- **Playbook:** `%AGENT_SKILLS_ROOT%\FOOLPROOF-SETUP.md`.
