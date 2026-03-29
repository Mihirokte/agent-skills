# Privacy and sensitive snapshots

Some files in `agent-skills` are **full copies** of machine-local configuration. Treat this folder like **credentials-adjacent data**.

## High sensitivity

### `config-snapshots/claude-code-global-state.json`

Copied from `C:\Users\rentk\.claude.json`. This file can include:

- A **`userID`** (opaque hash-style identifier)
- **Per-project usage**: costs in USD, token counts, model names, **session IDs**, durations
- **Absolute paths** to all projects Claude Code has touched (including outside `mihir`, e.g. `inomy`)
- **Feature-flag cache** and internal product experiment keys (`tengu_*`)

**Do not** commit this file to a public repository or share it in chat logs without redaction.

## Medium sensitivity

- `claude/claude-code-projects-mcp-snapshot.json` — project paths only (still identifies your filesystem layout).
- `claude/claude-code-settings.json` — permission allowlists and hook commands (persona injection text).
- `config-snapshots/cursor-user-settings.json` / `vscode-user-settings.json` — includes Gemini project id string and Postman temp instruction paths.

## Lower sensitivity

- MCP URLs and command lines (e.g. Linear SSE, Figma MCP) — useful but not secret by themselves.
- Extension lists — reveal tooling choices, not usually secrets.

If you need a **shareable** bundle, delete or redact `claude-code-global-state.json` first, then strip paths you do not want exposed.
