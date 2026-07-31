---
name: debate-shutdown
description: >
  Stop Debate Hall cursor-agent and folder-picker subprocesses without closing
  the hall server. Use for /debate-shutdown, "stop debate agents", or "kill hall
  agents" while keeping http://127.0.0.1:8765/ up.
---

# Debate shutdown (stop agents only)

## When to use

The user wants **running debate-related subprocesses stopped** but the **Debate Hall HTTP server** should **keep running**.

## What to run

**Loopback only** (server rejects other origins).

PowerShell:

```powershell
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:8765/api/hall/stop-agents" `
  -ContentType "application/json" -Body "{}"
```

Adjust host/port if the hall uses non-default `--host` / `--port`.

Bash:

```bash
curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://127.0.0.1:8765/api/hall/stop-agents
```

## UI

In **Town Hall** → **Clerk’s record** toolbar → **Stop agents**.

## Full server stop

To exit the hall process (and still tear down agents first): `POST /api/hall/shutdown`, or **Stop server** in `start_debate_hall.py` / the launcher window.

## Related

- Orchestration and behavior: the bundled `debate` skill.
- Runtime: the separately installed `debate-app` package.
