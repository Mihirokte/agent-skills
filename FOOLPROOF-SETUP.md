# Foolproof setup: `AGENT_SKILLS_ROOT`

This hub is the **single source of truth** for personal Cursor skills and cross-tool instructions on this machine.

## What is wired

| Mechanism | Purpose |
|-----------|---------|
| User env `AGENT_SKILLS_ROOT` | Points at this directory (set via `setx` / Install script). |
| Junction `%USERPROFILE%\.cursor\skills` → `...\agent-skills\cursor\skills` | Cursor only discovers skills under `~/.cursor/skills`; the junction makes that path **the same files** as the hub. |
| `~/.cursor/rules/agent-skills-root.mdc` | Always-on Cursor policy (copy maintained from `cursor/rules/` in the hub). |
| `~/.claude/rules/agent-skills-root.md` | Claude Code policy for **your** authored skills (not marketplace plugins). |
| `shared/instructions/00-always.md` | Loaded by Cursor / VS Code / Antigravity via `chat.instructionsFilesLocations`. |
| PowerShell profile | Sets `$env:AGENT_SKILLS_ROOT` in interactive shells when the registry value is missing (fallback). |

## Commands you should know

**Verify everything (CI / after updates):**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\rentk\mihir\agent-skills\scripts\Verify-AgentSkillsEnv.ps1"
```

Or double-click **`scripts\Verify-AgentSkillsEnv.cmd`** (shows output in a console window).

Exit code **0** = OK. Non-zero = run Install, then Verify again.

**Repair, reinstall junction, refresh rules, patch editor settings, profile bootstrap:**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\rentk\mihir\agent-skills\scripts\Install-AgentSkillsEnv.ps1"
```

Options:

- `-SkipProfile` — do not modify `Microsoft.PowerShell_profile.ps1`.
- `-SkipEditorSettings` — do not patch `settings.json` files.

**After Install or `setx`:** log off/on or restart Cursor, VS Code, Antigravity, and terminals so they read the updated user environment.

## Failure modes

| Symptom | Fix |
|---------|-----|
| `$env:AGENT_SKILLS_ROOT` empty in a **new** terminal | Run Install; open a **new** PowerShell window; or log off/on. |
| Cursor “lost” skills | Run Verify; if junction failed, run Install (recreates junction). **Never** recreate a plain `~/.cursor/skills` folder by hand. |
| `Verify` hash mismatch | Junction points at wrong target — run Install. |
| Profile errors on startup | Open profile, ensure lines match the block in `Install-AgentSkillsEnv.ps1` (no stray backticks before `$__user`). Re-run Install to refresh snippet only if you remove the `#region agent_skills_root_bootstrap` block first. |

## Moving the hub to another path

1. Move/copy the `agent-skills` tree.
2. Edit the hub path inside `Install-AgentSkillsEnv.ps1` is **not** required — the script resolves the hub from its own location.
3. Run **Install** from the **new** `scripts` folder (so `$HubRoot` resolves correctly).
4. Run **Verify**.

## New machine checklist

1. Clone or copy the `agent-skills` tree to a fixed path (or keep under `mihir\agent-skills`).
2. Run **Install** from `scripts\Install-AgentSkillsEnv.ps1`.
3. Run **Verify**.
4. Restart editors.
