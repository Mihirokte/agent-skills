# Capability matrix

agent-bridge only materializes artifacts a target **actually supports**.

| Artifact | Cursor | Claude Code | Codex |
|----------|--------|-------------|-------|
| Skills (`SKILL.md` directory) | `~/.cursor/skills/<id>/` | `~/.claude/skills/<id>/` | `~/.codex/skills/<id>/` |
| MCP servers | `~/.cursor/mcp.json` | `~/.claude.json` → `mcpServers` | `~/.codex/config.toml` → `mcp_servers` |
| Portable command hooks | Native `~/.cursor/hooks.json` events | Native `~/.claude/settings.json` matcher groups | **Unsupported** |

## Design rules

1. **Canonical store** — `~/.agent-bridge/` holds the source of truth.
2. **Materialize** — adapters copy/merge into native paths (not a shared mystery folder).
3. **Symlinks** — only with `agent-bridge init --link` (last resort).
4. **No unsupported features** — do not invent hooks for Codex.
5. **Secrets** — scrubbed to `${ENV}` in the store; real values in `secrets.env`.

## Portable hooks

Native hook files are not blindly copied. A hook must be added through
`agent-bridge add hook <manifest.json>` and use one of the shared lifecycle
events:

- `sessionStart`, `sessionEnd`
- `preToolUse`, `postToolUse`, `postToolUseFailure`
- `subagentStop`, `beforeSubmitPrompt`, `preCompact`, `stop`

Agent Bridge generates native Cursor and Claude configuration whose command is
`agent-bridge hook-run <id>`. The runner forwards stdin/stdout and exit status
to the canonical hook command. This keeps one command definition without
pretending the agents have identical JSON payloads.

Example:

```json
{
  "id": "audit-stop",
  "event": "stop",
  "command": "node /absolute/path/to/audit.mjs",
  "timeoutSeconds": 10
}
```

## Project scope

v1 is **user/global** only. Project-local `.cursor/mcp.json` / `.mcp.json` is planned later.
