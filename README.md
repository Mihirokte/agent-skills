# Agent Bridge

**Add a skill or MCP server once. Use it in Cursor, Claude Code, and Codex.**

Agent Bridge is a narrow, local-first sync package for the configuration that
AI coding agents can genuinely share:

- Agent Skills (`SKILL.md` directories)
- MCP servers (JSON ↔ Codex TOML adapters)
- A conservative subset of portable command hooks

It does not copy editor settings, chat history, credentials, rules dumps, or
unsupported features.

## Install

Node 22 or newer is required.

```bash
npm install -g github:Mihirokte/agent-skills
agent-bridge init
agent-bridge sync
agent-bridge status
```

`init` seeds the bundled skills into `~/.agent-bridge/skills` and materializes
them on the first sync. Use `--no-bundled` for an empty store.

## Add once

```bash
# A directory containing SKILL.md
agent-bridge add skill ./my-skill

# A JSON MCP definition, or import from an agent
agent-bridge add mcp ./mcp.json
agent-bridge add mcp --from cursor
agent-bridge add mcp --from claude
agent-bridge add mcp --from codex

# Explicitly portable hook manifest
agent-bridge add hook ./hook.json

# Keep native skill/MCP paths synchronized
agent-bridge watch
```

## Capability matrix

| Artifact | Cursor | Claude Code | Codex |
|----------|--------|-------------|-------|
| Skills | `~/.cursor/skills` | `~/.claude/skills` | `~/.codex/skills` |
| MCP | `~/.cursor/mcp.json` | `~/.claude.json` | `~/.codex/config.toml` |
| Portable hooks | native `hooks.json` | native `settings.json` schema | unsupported |

Arbitrary hooks are not auto-imported because event payloads and response
contracts differ. `add hook` accepts only the documented portable subset and
generates native configurations. See
[the full matrix](docs/CAPABILITY_MATRIX.md).

## Bundled skills

The old machine inventory has been reduced to reusable skills. There is one
copy of each runtime:

| Skill | Purpose |
|-------|---------|
| `agent-bridge` | Teaches agents to use this package when adding shared config |
| `aws` | Safe, profile-agnostic AWS CLI workflow |
| `swarm` | Native multi-agent decomposition and synthesis |
| `prism-status` | PRISM MCP status workflow |
| `debate` | Thin launcher for the separately installed Debate Hall app |
| `debate-shutdown` | Stops Debate Hall workers without duplicating its runtime |

Debate Hall implementation files remain in `debate-app`; this repository ships
only its small integration skill.

## Conflict safety

The canonical store is `~/.agent-bridge`.

1. New native skills/MCP servers are imported.
2. Matching items are left alone.
3. Divergent items are **not overwritten**. Both versions remain intact and a
   copy is written under `~/.agent-bridge/conflicts/`.
4. Non-conflicting canonical items are materialized to all enabled targets.

The watch daemon uses the same conflict-safe path and suppresses its own write
events to avoid loops.

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

## Why another sync tool?

Broader tools sync rules, settings, history, and other agent-specific state.
Agent Bridge intentionally stays small: capability-gated skills, MCP, and
portable hooks with explicit conflict handling.

MIT licensed.
