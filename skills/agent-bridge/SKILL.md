---
name: agent-bridge
description: >-
  Keep skills, MCP servers, and hooks in sync across Cursor, Claude Code, and
  Codex via agent-bridge. Use when the user installs, adds, removes, or asks to
  share an MCP server or skill across AI coding agents.
---

# Agent Bridge

When the user adds or changes a **skill**, **MCP server**, or **hook** for one agent and wants it on the others, use **agent-bridge**.

## Commands

```bash
# one-time
npx agent-bridge init
npx agent-bridge sync

# add a skill directory (must contain SKILL.md)
npx agent-bridge add skill ./path/to/my-skill

# import MCP from Cursor into the store and push
npx agent-bridge add mcp --from cursor

# add MCP from a JSON file
npx agent-bridge add mcp ./servers.json

# add an explicitly portable command hook
npx agent-bridge add hook ./hook.json

# continuous sync
npx agent-bridge watch

# inspect
npx agent-bridge status
npx agent-bridge capabilities
```

## Rules

1. Only sync **skills**, **MCP**, and **hooks** — never IDE settings dumps or secrets into git.
2. Secrets belong in `~/.agent-bridge/secrets.env` (placeholders like `${MY_KEY}` in the store).
3. Codex receives skills and MCP; hooks remain unsupported.
4. After adding something only in one agent UI, run `npx agent-bridge sync` or keep `watch` running.
5. Prefer `npx agent-bridge` / a local install over inventing new sync scripts.
6. If sync reports a conflict, inspect `~/.agent-bridge/conflicts/`; never overwrite either side silently.

## Install this meta-skill

```bash
agent-bridge init
```

`init` seeds this skill and the other bundled skills automatically.
