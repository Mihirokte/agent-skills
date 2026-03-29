# IDE extensions relevant to AI / agents

Generated from installed extension **folder names** under each app’s extensions directory. Full raw lists: `cursor-extensions-list.txt`, `vscode-extensions-list.txt`, `antigravity-extensions-list.txt`.

## Cursor (`~/.cursor/extensions`)

Notable for this inventory:

| Extension folder | Role |
|------------------|------|
| `google.gemini-cli-vscode-ide-companion-0.20.0-universal` | **Gemini CLI Companion** — bridges Gemini CLI to the IDE workspace (diff accept/cancel commands, etc.). |
| `prism-ai.prism-viz-0.1.0` | **PRISM VIZ** — graph visualization commands (`prism.vizOverview`, `prism.vizDependencies`). Distinct from the **Prism MCP server** configured in `~/.cursor/mcp.json`. |

All installed Cursor extension folders are listed in `cursor-extensions-list.txt`.

## Visual Studio Code (`~/.vscode/extensions`)

| Extension folder | Role |
|------------------|------|
| `anthropic.claude-code-2.1.63-win32-x64` | **Claude Code** extension (older build on disk). |
| `anthropic.claude-code-2.1.86-win32-x64` | **Claude Code** extension (newer build on disk). |
| `google.gemini-cli-vscode-ide-companion-0.20.0` | **Gemini CLI Companion**. |

Full list: `vscode-extensions-list.txt`.

## Antigravity (`~/.antigravity/extensions`)

The extensions directory existed at scan time; see `antigravity-extensions-list.txt` for contents (may be empty or minimal depending on profile).

## Vendor-bundled agent prompts

Some **non-AI** extensions ship `.claude/agents/*.md` or `.github/skills` for their own maintenance. Those live **inside** extension packages under `.cursor/extensions` or `.vscode/extensions` — they are **not** your personal skills. See `INVENTORY.md` §6.
