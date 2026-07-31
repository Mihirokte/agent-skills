# Capability matrix

agent-bridge only materializes artifacts a target **actually supports**.

| Artifact | Cursor CLI | Kiro CLI | Zed Agent |
|----------|------------|----------|-----------|
| Skills (`SKILL.md` directory) | `~/.cursor/skills/<id>/` | `~/.kiro/skills/<id>/` | `~/.agents/skills/<id>/` |
| MCP servers | `~/.cursor/mcp.json` | `~/.kiro/settings/mcp.json` | `~/.config/zed/settings.json` → `context_servers` |
| Portable command hooks | Native `~/.cursor/hooks.json` | **Unsupported** | **Unsupported** |

## Zed note

- Skills docs: https://zed.dev/docs/ai/skills → `~/.agents/skills/`
- MCP docs: https://zed.dev/docs/ai/mcp → `context_servers` in settings ([Configuring Zed](https://zed.dev/docs/configuring-zed))
- Settings file: `~/.config/zed/settings.json` (JSONC; comments preserved)
- **Zed Agent** uses synced skills + context_servers
- **External ACP** (Cursor / Kiro in Zed) use Cursor/Kiro native skill + MCP paths — also synced

## Design rules

1. **Canonical store** — `~/.agent-bridge/` holds the source of truth.
2. **Materialize** — adapters copy/merge into native paths.
3. **Symlinks** — only with `agent-bridge init --link` (last resort).
4. **No unsupported features** — do not invent MCP/hooks for Zed.
5. **Secrets** — scrubbed to `${ENV}` in the store; real values in `secrets.env`.
