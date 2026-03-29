# Scan methodology and coverage

This document explains how the `agent-skills` inventory was built and what is intentionally or practically **out of scope**.

## Roots that were scanned successfully

- `C:\Users\rentk\.cursor` — global MCP, rules, skills, extensions list
- `C:\Users\rentk\.claude` — Claude Code settings, plugins marketplace clone, session/project artifacts (indexed, not all copied)
- `C:\Users\rentk\.gemini` — CLI settings and extensions
- `C:\Users\rentk\AppData\Roaming\Cursor`, `...\Code`, `...\Antigravity`, `...\Claude`
- `C:\Users\rentk\AppData\Local\Programs` (top-level folder names only: Cursor, Antigravity, VS Code, Ollama, Arduino IDE, …)
- `C:\Users\rentk\mihir` — workspace rules, `AGENTS.md`, legacy `.gemini`, `CLAUDE.md`
- Selective reads of `C:\Users\rentk\.claude.json` (Claude Code global state)

## Recursive search limitations (Windows)

Tools that recurse from **`C:\Users\rentk`** or **`C:\Users\rentk\AppData\Local`** can hit:

`C:\Users\rentk\AppData\Local\ElevatedDiagnostics` → **Access is denied (os error 5)**

That aborts some glob/ripgrep walks of the entire `Local` or home directory. To avoid that, follow-up scans used **explicit safe subtrees** (e.g. `Roaming\Code\User`, `.cursor`, `Local\Programs`) instead of “all of Local”.

## Dotfolders checked (not found)

Under `C:\Users\rentk`, these common third-party agent IDE folders were **not present** at scan time:

`.windsurf`, `.continue`, `.roo`, `.kilocode`, `.aider`, `.codeium`, `.tabnine`, `.amazonq`, `.zed`, `.openai`, `.factory`, `.augment`, `.trae`, `.qoder`

If you install one later, re-run an inventory pass over that path.

## Partially covered or not exhaustively copied

| Area | What was done |
|------|----------------|
| **`C:\Users\rentk\inomy\...`** | Referenced only via **`~/.claude.json`** project keys and MCP entries (Linear). At re-scan time this path **did not exist** on disk (likely moved or removed), but Claude Code state still lists those projects — treat as **historical entries**. No crawl was possible. |
| **JetBrains / Android Studio AI** | No `AppData\JetBrains` scan in this pass. |
| **GitHub Copilot** | No `github.copilot` block in `vscode-user-settings.json` snapshot; extension may still be present under a different settings profile. |
| **Windows Registry / Group Policy** | Not scanned. |
| **Other drives** | Only user profile + `mihir` workspace tree under `C:\Users\rentk`. |
| **npm / pnpm project-local configs** | Only **global** npm top-level packages are listed (`cli/GLOBAL-NPM-PACKAGES.md`). |
| **Cursor `workspaceStorage` / chat session JSON** | Not copied (large, transient); only noted where relevant. |

## How to extend the inventory

1. Search additional roots: `AppData\Roaming\Windsurf`, `AppData\Local\Programs\<product>`, `Documents`, etc.
2. Run `Get-ChildItem -Path <safe-root> -Filter mcp.json -Recurse -ErrorAction SilentlyContinue` per product.
3. Copy new findings into `agent-skills/config-snapshots/` and append `INVENTORY.md`.
