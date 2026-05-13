# Repository Operating Contract

This repository is a self-hosted personal work-timer PWA with durable project memory in `docs/memory/`.

Always preserve these defaults unless the operator explicitly asks for a documented exception:
- Authentik + Nginx Proxy Manager forward-auth remains the browser/PWA auth boundary
- one active timer per user
- SQLite database file as the only persistent application state
- UTC ISO 8601 timestamps in storage
- documentation stays aligned with verified code changes

Keep the delivery flow explicit:
1. Research
2. Plan
3. Build
4. Verify

Runtime routing guidance:
- Use `AGENTS.md` as the just-in-time routing index.
- Use `.pi-rules` for durable workspace laws.
- Use `.pi-context` and `CONTEXT.md` for concise repository context.
- Use `docs/memory/INDEX.md` for the deeper map of the codebase.
- Read `docs/memory/invariants.md` and `docs/memory/decisions.md` before architectural changes.
- Load focused project-local skills from `.pi/skills/` only when they match the task.
- Prefer the project-local `local-builder` subagent for bounded, low-context code/doc/test tasks when a local Ollama model is sufficient.
- Prefer the project-local `local-reviewer` subagent for cheap first-pass review of small diffs, plans, prompts, docs, or bounded implementations.
- Prefer the project-local `repo-governor` subagent for governance, memory, and documentation-alignment work.
- `.pi/extensions/workflow-gate.ts` reinforces explicit Research -> Plan -> Build -> Verify flow for non-trivial tasks and can gate mutating actions when approval/verification is missing.

Safety boundaries:
- Treat destructive operations as confirmation-gated.
- Do not change auth, storage, or API invariants casually.
- If dependencies, API surface, auth flow, or data storage change, update `SECURITY.md` in the same task.
- If dev workflow, tooling, or contribution process changes, update `CONTRIBUTING.md`.
- If visible features or setup instructions change, update `README.md`.
