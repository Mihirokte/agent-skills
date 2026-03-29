---
name: prism-status
description: Reports PRISM GTR freshness/coverage by calling the `prism_status` MCP tool and formatting a detailed status report. Use when the user explicitly requests `prism_status` or asks to run PRISM status.
---

# PRISM Status

## When to use

Use this skill only when the user explicitly asks for `prism_status` (or equivalent phrasing like “run prism status”).

## Workflow

1. Call the MCP tool `prism_status`.
   - Always pass `root` as the current workspace root path.
   - If the user provided a specific repository path, use that as `root` instead.
2. Render a detailed report from the tool output.
3. Provide actionable next steps when appropriate (typically `prism_refresh`).

## Output template (detailed)

Return a response in this shape:

- **PRISM version**: `<metadata.prism_version>` (if present)
- **Built at**: `<data.builtAt>`
- **Files indexed**: `<data.fileCount>`
- **Symbols indexed**: `<data.symbolCount>`
- **GTR hash**: `<data.gtr_hash>`

Then add an interpretation block:

- If `symbolCount` is `0`: mention that symbol extraction appears empty; suggest running `prism_refresh`, then re-run `prism_status`.
- If `fileCount` is `0` or missing: mention the index likely failed or pointed at the wrong `root`; suggest verifying `root` and running `prism_refresh`.
- If `builtAt` is noticeably old relative to “now” (use judgment; default threshold: ~24h): label as “possibly stale” and suggest `prism_refresh`.

## Notes

- Do not invent fields that aren’t present in the tool output.
- If the tool call fails, report the failure and suggest re-running `prism_refresh` (or checking MCP server availability) before retrying `prism_status`.
