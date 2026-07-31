---
name: debate
description: Runs a multi-agent code debate through the separately installed Debate Hall application. Use when the user invokes /debate with a repository path.
---

# Debate

This skill is a **thin integration**. The Debate Hall runtime is deliberately
not copied into this repository.

## Prerequisite

The `debate-run` command must be installed and available on `PATH`. If it is
missing, tell the user to install the standalone `debate-app` package; do not
reimplement or copy its runtime into the skills directory.

## Run

When the user sends `/debate <directory>`:

1. Resolve and validate the directory.
2. Confirm `debate-run` is available.
3. Run:

   ```bash
   debate-run "<directory>"
   ```

4. Report where the generated `.debate/` artifacts were written.

For a persistent UI, run `debate-hall` and direct the user to the URL printed
by the application.

## Safety

- Treat Debate Hall as read-only review tooling unless the user explicitly
  requests implementation afterward.
- Do not vendor `debate.py`, Hall UI assets, or runtime files into this skill.
- Add `.debate/` to the reviewed repository's `.gitignore` when the user does
  not want run artifacts committed.
