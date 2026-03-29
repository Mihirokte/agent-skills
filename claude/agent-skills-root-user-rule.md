<!-- Mirror of %USERPROFILE%\.claude\rules\agent-skills-root.md for hub documentation -->

# Agent skills root (`AGENT_SKILLS_ROOT`)

## Canonical location

- **Environment variable:** `AGENT_SKILLS_ROOT` — set at user level on this machine (e.g. via `setx`). It points at the shared hub for **your** authored skills and inventories.
- **Default expanded path on this machine:** `C:\Users\rentk\mihir\agent-skills`
- **Cursor skills:** `%AGENT_SKILLS_ROOT%\cursor\skills\<skill-name>\SKILL.md`  
  Note: `%USERPROFILE%\.cursor\skills` is a **junction** to that `cursor\skills` folder so Cursor discovers skills correctly.

## Mandatory rule for new authored skills

1. When you **create** a new personal / machine-wide skill or shared playbook meant for multiple agents, add it under **`%AGENT_SKILLS_ROOT%`** in the appropriate subtree:
   - **Cursor-format skills:** `cursor\skills\<name>\SKILL.md`
   - **Shared chat instructions:** `shared\instructions\` (see files there)
2. Do **not** introduce a second duplicate canonical tree outside `AGENT_SKILLS_ROOT` for the same content.
3. Update **`%AGENT_SKILLS_ROOT%\README.md`** and **`%AGENT_SKILLS_ROOT%\INVENTORY.md`** when you add a globally documented skill.

## Scope note

- **Anthropic marketplace / plugin skills** under `~/.claude/plugins/` are **third-party or vendor-managed**; this rule applies to **your** skills and the hub, not to replacing plugin install locations.

## Cross-tool reference

When writing scripts or docs for the user, reference **`AGENT_SKILLS_ROOT`** by name so terminals and other AI tools can resolve the same path.

## Verify / repair

- `powershell -NoProfile -ExecutionPolicy Bypass -File "%AGENT_SKILLS_ROOT%\scripts\Verify-AgentSkillsEnv.ps1"`
- `powershell -NoProfile -ExecutionPolicy Bypass -File "%AGENT_SKILLS_ROOT%\scripts\Install-AgentSkillsEnv.ps1"`
- See `%AGENT_SKILLS_ROOT%\FOOLPROOF-SETUP.md`.
