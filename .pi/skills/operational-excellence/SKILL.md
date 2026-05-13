---
name: operational-excellence
description: Operational loop and repo hygiene guidance. Use when a task affects verification, documentation freshness, or agent workflow.
---

# Operational Excellence

Load this file when the task changes files, verification scope, or project documentation.

## Rules
- After a verified behavior change, update `../../../AGENTS.md` when routing guidance or standing requirements changed.
- After dependencies, API surface, auth flow, or storage changes, update `../../../SECURITY.md` in the same task.
- After dev setup, tooling, or contribution-process changes, update `../../../CONTRIBUTING.md`.
- After visible feature or setup changes, update `../../../README.md`.
- Prefer durable file-based guidance over chat-only instructions.
- Summaries should clearly state changed files, verification run, assumptions, and any follow-up work.

## Boundaries
- Treat destructive actions as confirmation-gated.
- Do not silently drift from documented invariants.
