# Privacy

agent-bridge is meant to be **published and shared**. Keep personal data out of the git repo.

## Never commit

- `~/.agent-bridge/secrets.env`
- Real API keys, tokens, cookies, OAuth material
- Machine inventory dumps / IDE `settings.json` snapshots
- Absolute Windows/macOS home paths tied to one user

## What sync does with secrets

When pulling MCP configs from Cursor, Claude Code, or Codex, values that look
like secrets are replaced with `${PLACEHOLDER}` in
`~/.agent-bridge/mcp/servers.json`. The original value may be appended to local
`secrets.env` so push can expand it on this machine only.

Secret detection is a safety net, not a guarantee. Review the canonical store
before sharing it.

## Safe to share

- This repository (templates use placeholders)
- Skill markdown without credentials
- MCP definitions that use `npx`/`uvx`/`docker` and `${ENV}` for keys
- Capability docs and the meta-skill

## Reporting

If you find a path that copies raw secrets into the canonical JSON without scrubbing, open an issue.
