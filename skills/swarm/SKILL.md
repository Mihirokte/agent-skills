---
name: swarm
description: When the user invokes /swarm, decompose independent work across multiple native subagents, scale the worker count with complexity, and synthesize one coherent result.
---

# Swarm (/swarm)

## When to use

Apply this skill whenever the user sends **`/swarm`** (with or without extra text in the same message). Treat it as an explicit command to **parallelize** the request across **multiple subagents**.

## Rules

1. **Minimum agents:** **n ≥ 2**. Never satisfy `/swarm` with a single subagent or a single serial plan without delegation.
2. **Scale n with complexity** — bias upward; when in doubt, **add another agent** rather than overload one.
   - **Small / localized** (one file, one bug, narrow question): **n = 2–3** (e.g. implement + verify, or explore + implement).
   - **Medium** (feature touching several files, API + UI, tests): **n = 3–5** (e.g. backend, frontend, tests, docs or integration).
   - **Large** (refactor, multi-package, audit, unfamiliar codebase): **n = 5–8+** (partition by subsystem, directory, concern, or risk).
   - **Very large / open-ended:** split by **independent workstreams** so agents do not block each other; **n as high as is useful** within practical limits (each `Task` must have a crisp prompt and clear deliverable).
3. **How to run the swarm:** Use the host agent's native subagent or delegation tool to launch **separate workers in parallel** (same turn if possible). If the host has no delegation capability, explain that `/swarm` is unsupported instead of simulating parallelism. Each worker gets:
   - A **narrow scope** and **concrete output** (files to touch, questions to answer, or artifacts to produce).
   - **No duplicate ownership** of the same file unless one agent reads and another writes with an explicit handoff in your merge step.
4. **You (orchestrator) must:**
   - Briefly state **n** and **why** that count matches complexity (one short paragraph).
   - After subagents return, **merge**: resolve conflicts, unify design, run or request a single validation pass, and produce **one coherent answer** for the user.
5. **If the user also gave a task description** in the `/swarm` message, that description is the **goal**; decomposition is yours.

## Anti-patterns

- One giant `Task` prompt that does everything.
- n = 1 or purely sequential subagents when work could run in parallel.
- Skipping synthesis so the user sees disconnected partial reports.

## Model hint

Use a general-purpose worker unless the host offers a more appropriate specialist. Use isolated worktrees for concurrent code edits when the host supports them.
