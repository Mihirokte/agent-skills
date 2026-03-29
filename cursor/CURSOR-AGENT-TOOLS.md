# Cursor agent tools (reference)

These are the **standard tools** typically available to the Cursor Composer / agent. Exact names and availability can change with Cursor updates; this list reflects the agent surface commonly documented in product integrations.

## Core

| Tool | Role |
|------|------|
| Read | Read file contents (text and some binary) |
| Write | Create or overwrite files |
| StrReplace | Apply targeted edits |
| Delete | Remove files |
| Glob | Find files by pattern |
| Grep | Ripgrep-style search |
| ReadLints | Editor diagnostics for paths |
| Shell | Run terminal commands |

## Planning & delegation

| Tool | Role |
|------|------|
| TodoWrite | Structured task list for multi-step work |
| Task | Spawn subagents (e.g. general-purpose, isolated worktrees) |

## Web

| Tool | Role |
|------|------|
| WebSearch | Search the public web |
| WebFetch | Fetch URL content as readable text |

## Notebooks

| Tool | Role |
|------|------|
| EditNotebook | Edit Jupyter cells |

## MCP

For each connected MCP server, the IDE exposes tools (often prefixed with `mcp_<server>_...`). On this machine the global MCP config includes **Excalidraw** and **Prism** — see `config-snapshots/cursor-global-mcp.json`.
