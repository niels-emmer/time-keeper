# Memory Index — Time Keeper

> Read this file at the start of every coding session. It tells you what the project is, where critical files live, and where to go for deeper context.

## What this project is

A personal work-timer PWA. The user tracks time in categories (aligned to Workday) from macOS and Android. At end of week, they copy a time summary into Workday's time registration.

- One active timer at a time per user
- Daily target: 8h average, weekly: 40h
- End-of-day rounding: minutes → whole hours (cap at 40h/week)
- Auth: Authentik embedded outpost via NPM forward auth (no auth code in the app)

## Critical files

| File | Why it matters |
|------|---------------|
| `packages/backend/src/db/schema.ts` | All data types flow from here |
| `packages/shared/src/utils/rounding.ts` | Core business logic — the rounding algorithm |
| `packages/backend/src/middleware/auth.ts` | Auth boundary — reads `X-authentik-email` header |
| `packages/frontend/src/components/CategoryGrid.tsx` | Primary UX surface |
| `docker-compose.yml` | Service wiring; nginx must pass `X-authentik-email` |
| `packages/backend/drizzle/` | Migration SQL files — committed, run on startup |

## Task routing

| You need to... | Start with |
|----------------|-----------|
| Change the data model | `packages/backend/src/db/schema.ts` → run `db:generate` |
| Change the rounding logic | `packages/shared/src/utils/rounding.ts` |
| Add an API endpoint | Add route in `packages/backend/src/routes/`, register in `app.ts` |
| Add a UI feature | `packages/frontend/src/pages/` or `components/` |
| Debug auth issues | `docs/integration/auth.md`, `packages/backend/src/middleware/auth.ts` |
| Deploy | `docs/operations/deployment.md` |
| Understand Docker layout | `docs/integration/docker.md` |
| Fix a recurring incident | `docs/memory/incidents.md` |

## Read next

- [invariants.md](invariants.md) — rules that must never be broken
- [decisions.md](decisions.md) — why we chose what we chose
- [incidents.md](incidents.md) — root causes of past problems

## Package commands cheat sheet

```bash
yarn install
yarn workspace @time-keeper/backend dev
yarn workspace @time-keeper/frontend dev
yarn workspace @time-keeper/backend db:generate    # after schema changes
yarn workspace @time-keeper/backend build
yarn workspace @time-keeper/frontend build
```
