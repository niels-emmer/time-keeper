# Time Keeper Context

Time Keeper is a self-hosted personal work-timer PWA aimed at a single person's real workflow, while still supporting multiple isolated users through Authentik-provided identity headers.

## Domain model
- A user tracks time in categories.
- Only one timer may be active per user at a time.
- Weekly summaries are the operational output.
- Monthly goals and billable flags support planning and reporting.
- Rounding is an explicit business rule and must respect the per-user weekly cap.

## Architectural shape
- `packages/frontend` contains the React PWA.
- `packages/backend` contains the Express API and Drizzle-backed SQLite access.
- `packages/shared` contains pure shared logic, especially rounding.
- `docs/memory/` is the durable architecture memory for agents.

## Operating model for agents
- `AGENTS.md` is the routing index.
- `.pi/APPEND_SYSTEM.md` is the minimal always-on operating contract.
- `.pi-rules` captures durable workspace laws.
- `.pi-context` is the concise session bootstrap summary.
- `docs/memory/INDEX.md` is the richer navigation map.

## Read next
- `docs/memory/INDEX.md`
- `docs/memory/invariants.md`
- `docs/memory/decisions.md`
