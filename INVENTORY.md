# Full inventory: MCPs, skills, rules, personas, tools

Absolute paths use `C:\Users\rentk\` as the user profile root unless noted.

---

## 0. Canonical hub: `AGENT_SKILLS_ROOT`

| Item | Detail |
|------|--------|
| **Env var** | `AGENT_SKILLS_ROOT` = `C:\Users\rentk\mihir\agent-skills` (user scope, `setx`) |
| **Cursor personal skills** | `%AGENT_SKILLS_ROOT%\cursor\skills\<name>\SKILL.md` |
| **Junction** | `C:\Users\rentk\.cursor\skills` → **`%AGENT_SKILLS_ROOT%\cursor\skills`** (Cursor discovery) |
| **Cursor rule** | `C:\Users\rentk\.cursor\rules\agent-skills-root.mdc` (`alwaysApply`) — hub mirror: `cursor/rules/agent-skills-root.mdc` |
| **Claude Code rule** | `C:\Users\rentk\.claude\rules\agent-skills-root.md` — hub mirror: `claude/agent-skills-root-user-rule.md` |
| **VS Code–family instructions** | `shared\instructions\` enabled in `chat.instructionsFilesLocations` (Cursor, VS Code, Antigravity) |
| **PowerShell profile** | `Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1` — bootstraps `AGENT_SKILLS_ROOT` (see `#region agent_skills_root_bootstrap`) |
| **Scripts** | `agent-skills\scripts\Verify-AgentSkillsEnv.ps1` (exit 0 = OK), `Install-AgentSkillsEnv.ps1` (idempotent repair) |
| **Runbook** | `agent-skills\FOOLPROOF-SETUP.md` |
| **Workspace reminder** | `mihir\.cursor\rules\agent-skills-hub.mdc` (reinforces hub when opening `mihir` in Cursor) |

**Mandatory:** New **personal** Cursor skills go only under the hub `cursor/skills/` tree; update this **README** and **INVENTORY** when adding documented skills. **Restart** editors after changing user env vars. Run **`scripts\Verify-AgentSkillsEnv.ps1`** after OS updates or if skills disappear.

**Limitation:** Claude Desktop app has no shared rule path like Cursor; use Claude Code + these instructions. Official Claude **plugins** remain under `~/.claude/plugins/`.

---

## 1. Cursor

### 1.1 MCP servers (global)

| Name | Type | Config |
|------|------|--------|
| `excalidraw` | Remote (HTTP/SSE) | `https://mcp.excalidraw.com` |
| `prism` | Local `node` | Runs `mihir\builder\packages\mcp-server\dist\cli.js` with `PRISM_ROOT` = `mihir\builder` |

**File:** `C:\Users\rentk\.cursor\mcp.json` → copied to `config-snapshots/cursor-global-mcp.json`.

### 1.2 Cursor rules (global, always-on)

| File | Scope |
|------|--------|
| `C:\Users\rentk\.cursor\rules\excalidraw-explain.mdc` | `alwaysApply: true` — use Excalidraw MCP when the user asks for explanations |
| `C:\Users\rentk\.cursor\rules\agent-skills-root.mdc` | `alwaysApply: true` — skills hub `AGENT_SKILLS_ROOT`; new skills under hub `cursor/skills` only |

Copy: `cursor/rules/excalidraw-explain.mdc`, `cursor/rules/agent-skills-root.mdc`.

### 1.3 Cursor skills (user-defined)

| Skill ID / folder | Purpose |
|-------------------|---------|
| `aws` | AWS CLI via `ai-agent-admin` profile; EC2-focused |
| `prism-status` | Call `prism_status` MCP tool and format PRISM GTR report |
| `swarm` | User says **`/swarm`** → split work across **n ≥ 2** parallel `Task` subagents; scale **n** up with complexity |
| `debate` | **`/debate <dir>`** → parallel eval, aggregate, **sequential per-finding debate** (default) or legacy vote; **three fixed debaters**; **stream.jsonl**; **guided planner** (`debate_planner.py`); **Debate Hall** (`hall_server.py`, UI `hall_web/`, run dirs under **`<target>/.debate/runs/`**, registry `debate_hall_data/run_registry.jsonl`, legacy `debate_hall_data/runs/`); APIs `/stream`, `/mermaid`, `/target-inspect`, `/plan-run/*`, **`/api/hall/stop-agents`**, `/api/hall/shutdown`. Ephemeral UI: `web/`. **`--hall-url` / `DEBATE_HALL_URL`**. **Claude Code:** [`claude/debate-skill.md`](./claude/debate-skill.md). |
| `debate-shutdown` | **`/debate-shutdown`** or “stop debate agents” → **`POST /api/hall/stop-agents`** (loopback); hall UI **Stop agents**; does not stop the HTTP server. See `cursor/skills/debate-shutdown/SKILL.md`. |

**Canonical path:** `%AGENT_SKILLS_ROOT%\cursor\skills\<name>\SKILL.md` (same files as `C:\Users\rentk\mihir\agent-skills\cursor\skills\...`).  
**Junction:** `%USERPROFILE%\.cursor\skills` → `%AGENT_SKILLS_ROOT%\cursor\skills` (Cursor loads via the junction).  
**Copies in hub:** `cursor/skills/aws/SKILL.md`, `cursor/skills/prism-status/SKILL.md`, `cursor/skills/swarm/SKILL.md`, `cursor/skills/debate/SKILL.md`, `cursor/skills/debate-shutdown/SKILL.md`.

### 1.4 Cursor managed / built-in skills (Cursor-managed manifest)

Manifest: `C:\Users\rentk\.cursor\skills-cursor\.cursor-managed-skills-manifest.json`

**Builtin skill IDs:** `create-rule`, `create-skill`, `create-subagent`, `migrate-to-skills`, `shell`, `update-cursor-settings`.

**Copies:** `cursor/skills-cursor/*-SKILL.md` and `cursor/skills-cursor/manifest.json`.

### 1.5 Cursor user settings (AI-related excerpts)

**File:** `C:\Users\rentk\AppData\Roaming\Cursor\User\settings.json` → `config-snapshots/cursor-user-settings.json`.

Notable keys:

- `chat.mcp.gallery.enabled`: `true`
- `geminicodeassist.project`, `geminicodeassist.agentYoloMode`
- `claudeCode.useTerminal`, `claudeCode.preferredLocation`, `claudeCode.disableLoginPrompt`
- `chat.agent.enabled`: `false`
- `chat.instructionsFilesLocations`: enables `.github/instructions`, `.claude/rules`, **`C:\Users\rentk\mihir\agent-skills\shared\instructions`**, and several Postman temp instruction paths

### 1.6 Cursor / Composer agent tool surface (IDE agent)

These are the tools exposed to the **Cursor agent** in the product (names may vary slightly by release). They are **not** stored as a user file; they come from the agent runtime:

- **Filesystem / repo:** `Read`, `Glob`, `Grep`, `Write`, `StrReplace`, `Delete`, `ReadLints`
- **Execution:** `Shell` (terminal commands)
- **Notebook:** `EditNotebook`
- **Tasks:** `Task` (subagents: general-purpose, best-of-n runner)
- **Web:** `WebSearch`, `WebFetch`
- **Planning:** `TodoWrite`
- **MCP:** user-configured servers (here: Excalidraw, Prism) plus any MCP resources listing/fetch if exposed
- **Other:** `mcp_*` prefixed tools for each connected MCP

### 1.7 Workspace MCP hints (Cursor project cache)

Under `C:\Users\rentk\.cursor\projects\<project-id>\mcps\` Cursor stores per-project MCP instruction files (e.g. `user-prism/STATUS.md`, `cursor-ide-browser/INSTRUCTIONS.md`). These are **generated/cache** artifacts, not primary configuration.

---

## 2. Visual Studio Code (Microsoft) & Antigravity

### 2.1 MCP

**File:** `C:\Users\rentk\AppData\Roaming\Code\User\mcp.json`  
Current content: `{ "servers": {} }` (no MCP servers configured).  
Copy: `config-snapshots/vscode-user-mcp.json`.

### 2.2 User settings

- **VS Code:** `config-snapshots/vscode-user-settings.json` (standalone snapshot; AI-related keys match Cursor/Antigravity in this environment).
- **Cursor / Antigravity:** `config-snapshots/cursor-user-settings.json`, `config-snapshots/antigravity-user-settings.json`.

Antigravity ships an MCP config schema at  
`AppData\Local\Programs\Antigravity\resources\app\extensions\antigravity\schemas\mcp_config.schema.json` (product file, not snapshotted).

---

## 3. Claude (Desktop app + Claude Code CLI)

### 3.1 Claude Desktop `claude_desktop_config.json`

**Path:** `C:\Users\rentk\AppData\Roaming\Claude\claude_desktop_config.json`  
On this machine it only contains `preferences` (cowork, sidebar, web search, permissions mode, etc.) — **no `mcpServers` block** in the file.  
Copy: `config-snapshots/claude-desktop-config.json`.

### 3.2 Claude Desktop — installed MCP extensions (registry)

**Path:** `C:\Users\rentk\AppData\Roaming\Claude\extensions-installations.json`  
Copy: `claude/claude-desktop-mcp-extensions-installations.json`.

| Extension ID | Name | MCP launch | Declared tools (summary) |
|--------------|------|------------|---------------------------|
| `ant.dir.cursortouch.windows-mcp` | Windows-MCP | `uv run windows-mcp` from extension dir | `App`, `Shell`, `Snapshot`, `Click`, `Type`, `Scroll`, `Move`, `Shortcut`, `Wait`, `Scrape`, `MultiSelect`, `MultiEdit` |
| `ant.dir.gh.awslabs.aws-api-mcp-server` | AWS API MCP Server | `uv run` Python module `awslabs.aws_api_mcp_server.server` | `suggest_aws_commands`, `call_aws` |

Extension payloads live under  
`C:\Users\rentk\AppData\Roaming\Claude\Claude Extensions\<id>\`.

### 3.3 Claude Code — `settings.json` (global)

**Path:** `C:\Users\rentk\.claude\settings.json` → copy `claude/claude-code-settings.json`.

Highlights:

- **`model`:** `opus`
- **`enableAllProjectMcpServers`:** `true`
- **`effortLevel`:** `high`
- **`voiceEnabled`:** `true`
- **`permissions.allow`:** large explicit allowlist for `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Write`, `Edit`, many `Bash(...)` patterns, `additionalDirectories` for one extra path
- **`hooks`:** see §3.5 (persona)

### 3.4 Claude Code — local settings overrides

| File | Copy |
|------|------|
| `C:\Users\rentk\.claude\settings.local.json` | `claude/claude-code-settings.local.json` |
| `C:\Users\rentk\mihir\.claude\settings.local.json` | `claude/mihir-project-settings.local.json` |

Project local file adds extra `Bash` permission allow rules for git push and historical `robocopy` moves.

### 3.4b Claude Code — user rule for skills hub

**Path:** `C:\Users\rentk\.claude\rules\agent-skills-root.md` — mandates authored skills / shared playbooks under **`AGENT_SKILLS_ROOT`** (does not relocate Anthropic marketplace plugins). Hub mirror: `claude/agent-skills-root-user-rule.md`.

### 3.5 Persona (Claude Code hooks — not a separate “persona file”)

Configured via **`hooks`** in `claude/claude-code-settings.json`:

- **`SessionStart`:** runs a PowerShell command to start `bb-theme.py`, and a **`jq`** command that injects **Jesse Pinkman (Breaking Bad)** voice instructions into `additionalContext` for the session.
- **`UserPromptSubmit`:** **`jq`** hook reinjects a shorter reminder to stay in the same voice.
- **`PostToolUse`:** matcher `Write|Edit` — shell pipeline logs copies of edited files under `.claude/edits/`.

This is the only explicit **persona** configuration found in scanned configs (aside from generic “be helpful” defaults in products).

### 3.6 Claude Code — tools implied by `permissions.allow`

Claude Code’s tool names align with the allowlist entries, e.g. `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Bash`, plus any MCP tools from enabled servers/extensions.

### 3.7 Official plugin marketplace (on disk)

**Marketplace registry:** `C:\Users\rentk\.claude\plugins\known_marketplaces.json` — `claude-plugins-official` from `anthropics/claude-plugins-official`.

**Plugins folder:** `...\claude-plugins-official\plugins\`

Plugin directories present include:

`agent-sdk-dev`, `clangd-lsp`, `claude-code-setup`, `claude-md-management`, `code-review`, `code-simplifier`, `commit-commands`, `csharp-lsp`, `example-plugin`, `explanatory-output-style`, `feature-dev`, `frontend-design`, `gopls-lsp`, `hookify`, `jdtls-lsp`, `kotlin-lsp`, `learning-output-style`, `lua-lsp`, `math-olympiad`, `mcp-server-dev`, `php-lsp`, `playground`, `plugin-dev`, `pr-review-toolkit`, `pyright-lsp`, `ralph-loop`, `ruby-lsp`, `rust-analyzer-lsp`, `security-guidance`, `skill-creator`, `swift-lsp`, `typescript-lsp`.

**Plugins that bundle `SKILL.md` under `plugins/`** (authoring templates / examples):

- `skill-creator` → `skills/skill-creator/SKILL.md`
- `plugin-dev` → multiple skills (`agent-development`, `command-development`, `hook-development`, `mcp-integration`, `plugin-settings`, `plugin-structure`, `skill-development`)
- `playground`, `mcp-server-dev` (×3), `math-olympiad`, `hookify`, `frontend-design`, `example-plugin` (×2), `claude-md-management`, `claude-code-setup`

**External plugins folder:** `...\external_plugins\`

Directories: `asana`, `context7`, `discord`, `fakechat`, `firebase`, `github`, `gitlab`, `greptile`, `imessage`, `laravel-boost`, `linear`, `playwright`, `serena`, `slack`, `supabase`, `telegram`, `terraform`.

**Bundled `SKILL.md` in `external_plugins`:** `discord`, `imessage`, `telegram` — each with `skills/configure/SKILL.md` and `skills/access/SKILL.md`.

> **Note:** Having the marketplace cloned does not mean every plugin is **enabled** for every session; enablement is controlled inside Claude Code. This inventory records **what is installed on disk**.

**Complete `SKILL.md` path listing (marketplace clone):** `claude/all-official-marketplace-SKILL-md-paths.txt` (relative to `%USERPROFILE%` for each line).

### 3.8 Claude Code runtime subagents

Session subagent logs (JSONL) exist under:

`C:\Users\rentk\.claude\projects\<encoded-path>\<session-id>\subagents\`

These are **runtime transcripts**, not static “persona” definitions.

### 3.9 Claude Code global state file (`~/.claude.json`)

**Path:** `C:\Users\rentk\.claude.json` → **`config-snapshots/claude-code-global-state.json`** (full copy; see `PRIVACY-NOTE.md`).

This file stores Claude Code **installation metadata**, **feature-flag cache** (`cachedGrowthBookFeatures`), and a **`projects`** map keyed by absolute project paths. Each project entry can define **`mcpServers`**, usage stats, session IDs, and model token summaries.

**Enabled plugin slugs** (from `cachedGrowthBookFeatures.tengu_amber_lattice.plugins`) — also extracted to `claude/claude-code-feature-flags-plugins.json`:

`security-guidance`, `code-review`, `commit-commands`, `code-simplifier`, `hookify`, `feature-dev`, `frontend-design`, `pr-review-toolkit`, `skill-creator`, `plugin-dev`, `agent-sdk-dev`, `mcp-server-dev`, `claude-code-setup`, `claude-md-management`, `playground`, `ralph-loop`, `explanatory-output-style`, `learning-output-style`, plus **LSP helper plugins**: `clangd-lsp`, `csharp-lsp`, `gopls-lsp`, `jdtls-lsp`, `kotlin-lsp`, `lua-lsp`, `php-lsp`, `pyright-lsp`, `ruby-lsp`, `rust-analyzer-lsp`, `swift-lsp`, `typescript-lsp`.

**Harbor ledger** (`tengu_harbor_ledger`) entries reference marketplace plugins: `discord`, `telegram`, `fakechat`, `imessage` (from `claude-plugins-official`).

**Per-project MCP (from state file)** — full structured extract: `claude/claude-code-projects-mcp-snapshot.json`. Summary:

| Project path | `mcpServers` |
|--------------|--------------|
| `C:/Users/rentk` | `linear-server` → `https://mcp.linear.app/sse` (SSE) |
| `C:/Users/rentk/inomy` | same |
| `C:/Users/rentk/inomy/working-notes` | same |
| `C:/Users/rentk/inomy/es-data-pipeline`, `.../inomy-mono`, `C:/Users/rentk/mihir`, `mihir/pokecity`, `mihir/all-doing-bot`, `mihir/main`, worktrees under `mihir\pokecity`, `mihir\aladdin`, etc. | `{}` (none in state) |

Mixed slash styles (`C:/` vs `C:\`) appear as stored by Claude Code.

**Other flags (examples):** `tengu_claudeai_mcp_connectors`: true, `tengu_mcp_tool_search`: true, `tengu_mcp_elicitation`: true (see full JSON).

---

## 4. Gemini (CLI + IDE integration)

### 4.1 User settings (profile default)

**Path:** `C:\Users\rentk\.gemini\settings.json` → `gemini/user-settings.json`  
Contains OAuth / security preferences for the CLI.

### 4.1b Legacy repo-local Gemini MCP (`mihir/old`)

**Path:** `C:\Users\rentk\mihir\old\.gemini\settings.json` → `gemini/mihir-old-dot-gemini-settings.json`

| Server | Config |
|--------|--------|
| `figma` | `https://mcp.figma.com/mcp` (`type`: `http`) |
| `blender` | `uvx --python 3.12 blender-mcp` |

This is **separate** from the profile-level `~/.gemini/settings.json` and applies when using Gemini CLI from that tree if the tool loads repo-local config.

### 4.2 Installed extension with MCP

**Path:** `C:\Users\rentk\.gemini\extensions\google-workspace\gemini-extension.json`  
Copy: `gemini/google-workspace-gemini-extension.json`.

Declares MCP server `google-workspace`: `node dist/index.js` with `cwd` = `${extensionPath}`.

### 4.3 Gemini / Gemini Code Assist in VS Code–family editors

From `settings.json`: `geminicodeassist.project` and `geminicodeassist.agentYoloMode` are set (see Cursor/Antigravity snapshots).

---

## 5. Repository workspace rules (`mihir` tree)

### 5.1 `all-doing-bot`

| Artifact | Path | Copy |
|----------|------|------|
| Cursor rule | `mihir\all-doing-bot\.cursor\rules\always-push-github.mdc` | `workspace-rules/all-doing-bot/` |
| Agent instructions | `mihir\all-doing-bot\AGENTS.md` | same folder |

### 5.2 `old/catan` (legacy project)

| Files | Path |
|-------|------|
| Cursor rules | `mihir\old\catan\.cursor\rules\*.mdc` (`ai-agent`, `websocket-protocol`, `frontend-js`, `backend-python`, `catan-project`) |

Copies: `workspace-rules/old-catan/*.mdc`.

### 5.3 Other `SKILL.md` under `mihir` (historical)

- `mihir\old\x-research-skill\SKILL.md` — legacy X research skill; copy at `workspace-rules/old-x-research-skill/SKILL.md`.

### 5.4 Legacy `CLAUDE.md` (project instructions, `mihir/old`)

Copied to **`workspace-instructions/`** (for agent context in those repos):

- `mihir/old/CLAUDE.md` → `workspace-instructions/mihir-old-root-CLAUDE.md`
- `mihir/old/catan/CLAUDE.md` → `mihir-old-catan-CLAUDE.md`
- `mihir/old/agent-orchestrator/CLAUDE.md` → `mihir-old-agent-orchestrator-CLAUDE.md`
- `mihir/old/ai-agent-session-center/CLAUDE.md` → `mihir-old-ai-agent-session-center-CLAUDE.md`

---

## 6. Other installations touching “agents” / MCP (observed)

| Component | Notes |
|-----------|--------|
| **Ollama** | Installed under `C:\Users\rentk\AppData\Local\Programs\Ollama\`. No user `Modelfile` inventory was collected; `.ollama` exists under the profile but may be empty or opaque to listing. See `ollama/NOTE.md`. |
| **happy-coder** (`happy-coder` npm global) | Client for Claude Code / Codex; ships **`happy-mcp`** CLI (`bin/happy-mcp.mjs`) for MCP bridging. No separate user MCP JSON found. |
| **`@google/gemini-cli`** (npm global) | Gemini CLI; example extension templates under package `dist/.../examples/`. |
| **`@linear/cli`** (npm global) | Linear CLI (related to Linear MCP usage in Claude Code state). |
| **pnpm** (npm global) | Package manager; not an agent by itself. |
| Prettier VS Code extension | Contains `.claude/agents/*.md` agent prompts inside the extension package under both `.vscode/extensions` and `.cursor/extensions` — **vendor-shipped**, not user config |
| Python `vscode-python-envs` extension | Contains `.github/skills/*.md` for extension maintenance — **vendor-shipped** |

---

## 7. IDE extensions (installed folders)

Full extension ID lists (publisher.name-version):

- **Cursor:** `extensions/cursor-extensions-list.txt` (29 folders at scan time).
- **VS Code:** `extensions/vscode-extensions-list.txt`.
- **Antigravity:** `extensions/antigravity-extensions-list.txt`.

**AI-related highlights (Cursor):** `google.gemini-cli-vscode-ide-companion-0.20.0-universal` (Gemini CLI Companion), `prism-ai.prism-viz-0.1.0` (commands `prism.vizOverview`, `prism.vizDependencies` — separate from the Prism **MCP** in Cursor `mcp.json`).

**VS Code:** `anthropic.claude-code-2.1.63-win32-x64`, `anthropic.claude-code-2.1.86-win32-x64`, `google.gemini-cli-vscode-ide-companion-0.20.0`.

See **`extensions/IDE-AI-EXTENSIONS.md`** for a short narrative summary.

---

## 8. Scan methodology and gaps

See **`SCAN-METHODOLOGY.md`**: which roots were searched, why recursive scans under `%USERPROFILE%` or `%LOCALAPPDATA%` can fail (`ElevatedDiagnostics` access denied), and what was **not** exhaustively enumerated (e.g. every file under `inomy` repos, JetBrains AI configs if absent, Windsurf/Continue dotfolders — **not present** under `C:\Users\rentk` at scan time).

---

## 9. Privacy

**`config-snapshots/claude-code-global-state.json`** can contain **user identifiers**, **token/cost summaries**, **session IDs**, and **absolute paths** to other projects (`inomy`, etc.). Do not share publicly without redaction. See **`PRIVACY-NOTE.md`**.

---

## 10. Files in this `agent-skills` directory

| Path | Description |
|------|-------------|
| `README.md` | Overview |
| `INVENTORY.md` | This document |
| `SCAN-METHODOLOGY.md` | How the machine was scanned and known limits |
| `PRIVACY-NOTE.md` | Sensitive snapshot warnings |
| `config-snapshots/*` | MCP + editor JSON + **full `claude-code-global-state.json`** |
| `cursor/rules`, `cursor/skills`, `cursor/skills-cursor` | Global Cursor rules and **canonical** personal skills (`AGENT_SKILLS_ROOT`) |
| `shared/instructions/` | Cross-tool chat instructions (`00-always.md`) |
| `claude/agent-skills-root-user-rule.md` | Mirror of `~/.claude/rules/agent-skills-root.md` |
| `workspace-rules/*` | Per-repo rules + `AGENTS.md` + legacy skill |
| `workspace-instructions/*` | Legacy `CLAUDE.md` copies |
| `claude/*` | Desktop MCP extensions, Code settings, marketplace paths, **project MCP extract**, **feature-flag plugin list** |
| `gemini/*` | Profile settings, google-workspace extension, **old repo Figma/Blender MCP** |
| `extensions/*` | Full extension folder lists + IDE-AI-EXTENSIONS.md |
| `cli/GLOBAL-NPM-PACKAGES.md` | Global npm packages at scan time |
| `ollama/NOTE.md` | Ollama install note |
| `scripts/*.ps1` | Verify / Install automation for hub + junction + rules |
| `FOOLPROOF-SETUP.md` | Recovery and new-machine checklist |
