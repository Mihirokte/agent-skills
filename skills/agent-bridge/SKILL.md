---
name: agent-bridge
description: >-
  Keep skills, MCP servers, and hooks in sync across Cursor CLI, Kiro CLI, and
  Zed Agent via agent-bridge. Use when the user installs, adds, removes, or asks
  to share an MCP server or skill across AI coding agents. Zed Agent skills go
  in ~/.agents/skills; ACP Cursor/Kiro in Zed use their own skill dirs.
---

# Agent Bridge

When the user adds or changes a **skill**, **MCP server**, or **hook** for Cursor,
Kiro, or Zed Agent and wants it elsewhere, use **agent-bridge**.

## Commands

```bash
agent-bridge init
agent-bridge sync
agent-bridge add skill ./path/to/my-skill
agent-bridge add mcp --from kiro
agent-bridge add mcp ./servers.json
agent-bridge add hook ./hook.json
agent-bridge watch
agent-bridge status
agent-bridge capabilities
```

## Rules

1. Only sync **skills**, **MCP**, and **hooks** — never IDE settings dumps or secrets into git.
2. Secrets belong in `~/.agent-bridge/secrets.env`.
3. Kiro: skills + MCP. Zed: skills (`~/.agents/skills`) + MCP (`context_servers` in `~/.config/zed/settings.json`). Hooks: Cursor only.
4. In Zed chat:
   - **Zed Agent** → uses synced `~/.agents/skills` + `context_servers`
   - **Cursor / Kiro ACP** → uses those agents' own skill/MCP dirs (also synced)
5. After adding something only in one place, run `agent-bridge sync` or keep `watch` running.
6. Conflicts live under `~/.agent-bridge/conflicts/`; never overwrite silently.

## Install this meta-skill

```bash
agent-bridge init
```
