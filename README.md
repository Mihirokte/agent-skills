# Agent Bridge

**Add a skill or MCP server once. Use it in Cursor CLI, Kiro CLI, and Zed Agent.**

Agent Bridge is a narrow, local-first sync package for the configuration that
AI coding agents can genuinely share:

- Agent Skills (`SKILL.md` directories)
- MCP servers (JSON) for Cursor and Kiro
- A conservative subset of portable command hooks (Cursor only)

It does not copy editor settings, chat history, credentials, or unsupported
features. Zed Agent skills live in `~/.agents/skills` (official path). External
ACP agents inside Zed still use Cursor/Kiro skill dirs.

## Install

Node 22 or newer is required.

```bash
npm install -g github:Mihirokte/agent-skills
agent-bridge init
agent-bridge sync
agent-bridge status
```

## Add once

```bash
agent-bridge add skill ./my-skill
agent-bridge add mcp ./mcp.json
agent-bridge add mcp --from cursor
agent-bridge add mcp --from kiro
agent-bridge add hook ./hook.json
agent-bridge watch
```

## Capability matrix

| Artifact | Cursor CLI | Kiro CLI | Zed Agent |
|----------|------------|----------|-----------|
| Skills | `~/.cursor/skills` | `~/.kiro/skills` | `~/.agents/skills` |
| MCP | `~/.cursor/mcp.json` | `~/.kiro/settings/mcp.json` | `~/.config/zed/settings.json` → `context_servers` |
| Portable hooks | native `hooks.json` | unsupported | unsupported |

See [the full matrix](docs/CAPABILITY_MATRIX.md).

## Bundled skills

| Skill | Purpose |
|-------|---------|
| `agent-bridge` | Teaches agents to use this package when adding shared config |
| `aws` | Safe, profile-agnostic AWS CLI workflow |
| `swarm` | Native multi-agent decomposition and synthesis |
| `prism-status` | PRISM MCP status workflow |
| `debate` | Thin launcher for the separately installed Debate Hall app |
| `debate-shutdown` | Stops Debate Hall workers without duplicating its runtime |

## Conflict safety

The canonical store is `~/.agent-bridge`.

1. New native skills/MCP servers are imported.
2. Matching items are left alone.
3. Divergent items are **not overwritten**. Both versions remain intact and a
   copy is written under `~/.agent-bridge/conflicts/`.
4. Non-conflicting canonical items are materialized to all enabled targets.

## Secrets

Likely MCP secrets are replaced with `${ENV_NAME}` in the canonical JSON. The
local value is kept in `~/.agent-bridge/secrets.env`, which must never be
committed. See [Privacy](docs/PRIVACY.md).

## Development

```bash
npm install
npm run check
node dist/cli.js --help
```

MIT licensed.
