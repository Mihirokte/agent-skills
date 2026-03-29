# Agent skills and AI configuration inventory

This directory is the **canonical hub** for machine-wide agent skills and related inventory on this PC. It is also a **snapshot and index** of MCP servers, Cursor skills/rules, Claude Code settings, VS Code / Antigravity / Gemini-related settings, CLI tools, IDE extensions, and workspace-level agent instructions.

## `AGENT_SKILLS_ROOT` (environment variable)

- **Name:** `AGENT_SKILLS_ROOT`
- **Value (this machine):** `C:\Users\rentk\mihir\agent-skills` — set with **user**-level `setx` (restart Cursor / VS Code / terminals so new processes inherit it).
- **Cursor skills:** Author under **`%AGENT_SKILLS_ROOT%\cursor\skills\<name>\SKILL.md`**.  
  **`%USERPROFILE%\.cursor\skills`** is a **directory junction** to that folder (Cursor does not support a custom skills path in settings).
- **Policies:** Global Cursor rule `~/.cursor/rules/agent-skills-root.mdc` (always on); Claude Code `~/.claude/rules/agent-skills-root.md`; shared chat instructions in [`shared/instructions/00-always.md`](./shared/instructions/00-always.md), registered in **Cursor, VS Code, and Antigravity** via `chat.instructionsFilesLocations`.
- **PowerShell profile:** `Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1` bootstraps `AGENT_SKILLS_ROOT` from the user registry or falls back to this hub (installed by **`scripts/Install-AgentSkillsEnv.ps1`**).
- **Foolproof guide:** [`FOOLPROOF-SETUP.md`](./FOOLPROOF-SETUP.md).
- **Scripts:** [`scripts/Verify-AgentSkillsEnv.ps1`](./scripts/Verify-AgentSkillsEnv.ps1) (health check), [`scripts/Install-AgentSkillsEnv.ps1`](./scripts/Install-AgentSkillsEnv.ps1) (idempotent repair).

## How to use

1. Read [`INVENTORY.md`](./INVENTORY.md) for the canonical structured list.
2. Read [`SCAN-METHODOLOGY.md`](./SCAN-METHODOLOGY.md) for **coverage and gaps** (e.g. `ElevatedDiagnostics` access denied, paths not crawled).
3. Read [`PRIVACY-NOTE.md`](./PRIVACY-NOTE.md) before sharing anything — **`config-snapshots/claude-code-global-state.json` is sensitive.**

## Directory map

| Path | Contents |
|------|-----------|
| `config-snapshots/` | `cursor-global-mcp.json`, VS Code `mcp.json`, Cursor/Antigravity/VS Code `settings.json`, Claude Desktop config, **full `claude-code-global-state.json`** (`~/.claude.json`) |
| `cursor/` | Hub copies of global rules + personal skills tree (`cursor/skills/` is the real store; `~/.cursor/skills` junction); [`CURSOR-AGENT-TOOLS.md`](./cursor/CURSOR-AGENT-TOOLS.md). The **`debate`** skill: orchestrator `cursor/skills/debate/debate.py`; **Debate Hall** UI in `cursor/skills/debate/hall_web/` (served by `hall_server.py` at `http://127.0.0.1:8765/`, APIs include `/target-inspect`, `/plan-run/*`, stream, mermaid); ephemeral dashboard `cursor/skills/debate/web/`. Claude Code: hub copy [`claude/debate-skill.md`](./claude/debate-skill.md) installs to `~/.claude/rules/debate-skill.md` via [`scripts/Install-AgentSkillsEnv.ps1`](./scripts/Install-AgentSkillsEnv.ps1). |
| `shared/instructions/` | Cross-tool chat instructions (`00-always.md`) loaded by Cursor / VS Code / Antigravity |
| `workspace-rules/` | Per-repo `.cursor` rules, `AGENTS.md`, legacy `x-research-skill` |
| `workspace-instructions/` | Legacy `CLAUDE.md` copies from `mihir/old/*` |
| `claude/` | Desktop MCP extension registry, Claude Code `settings*.json`, marketplace registry, **`claude-code-projects-mcp-snapshot.json`**, **`claude-code-feature-flags-plugins.json`**, `all-official-marketplace-SKILL-md-paths.txt` |
| `gemini/` | Profile `settings.json`, `google-workspace` extension manifest, **`mihir-old-dot-gemini-settings.json`** (Figma + Blender MCP in old repo) |
| `extensions/` | Full extension folder lists + [`IDE-AI-EXTENSIONS.md`](./extensions/IDE-AI-EXTENSIONS.md) |
| `cli/` | [`GLOBAL-NPM-PACKAGES.md`](./cli/GLOBAL-NPM-PACKAGES.md) |
| `ollama/` | [`NOTE.md`](./ollama/NOTE.md) |
| `scripts/` | `Verify-AgentSkillsEnv.ps1`, `Install-AgentSkillsEnv.ps1` |
| `FOOLPROOF-SETUP.md` | Recovery, checklists, failure modes |

## Source locations not fully duplicated

- Claude Code plugin marketplace clone: `C:\Users\rentk\.claude\plugins\marketplaces\claude-plugins-official\`
- Claude Code session subagent transcripts: `C:\Users\rentk\.claude\projects\*\*\subagents\`
- Other projects on disk (e.g. under `C:\Users\rentk\inomy`) appear in **`~/.claude.json`** but were not deep-scanned for repo-local `.cursor` / `CLAUDE.md`.

## Regenerating

Re-run discovery (PowerShell safe-path walks, selective copies) and merge into this tree; update the date in this README.
