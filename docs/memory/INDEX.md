# Memory Index — Time Keeper

> Read this file at the start of every coding session. It tells you what the project is, where critical files live, and where to go for deeper context.

## What this project is

A personal work-timer PWA. The user tracks time in categories (aligned to Workday) from macOS and Android. At end of week, they copy a time summary into Workday's time registration.

- One active timer at a time per user
- Configurable weekly goal (default 40 h) stored per user in `user_settings`
- End-of-day rounding: minutes → nearest 30 or 60 min interval (configurable, default 60; capped at user's weekly goal)
- Auth: Authentik embedded outpost via NPM forward auth (no auth code in the app)

## Critical files

| File | Why it matters |
|------|---------------|
| `packages/backend/src/db/schema.ts` | All data types flow from here (`categories`, `time_entries`, `user_settings`) |
| `packages/shared/src/utils/rounding.ts` | Core business logic — the rounding algorithm |
| `packages/backend/src/middleware/auth.ts` | Auth boundary — reads `X-authentik-email` header |
| `packages/backend/src/routes/settings.ts` | GET/PUT `/api/settings` — weekly goal hours + rounding increment |
| `packages/backend/src/services/summaryService.ts` | Builds weekly summary; reads weekly goal + rounding increment from DB |
| `packages/frontend/src/components/CategoryGrid.tsx` | Primary UX surface |
| `packages/frontend/src/components/CategoryManager.tsx` | Category CRUD + drag-to-reorder + A-Z sort |
| `packages/frontend/src/components/WeeklyGoalSetting.tsx` | Settings UI for weekly goal (number input + slider) + rounding increment toggle |
| `docker-compose.yml` | Service wiring; nginx must pass `X-authentik-email` |
| `packages/backend/drizzle/` | Migration SQL files — committed, run on startup |
| `packages/shared/src/utils/rounding.test.ts` | Unit tests for the rounding algorithm (Vitest) |
| `packages/backend/src/routes/settings.test.ts` | Unit tests for the settings route (Vitest) |
| `SECURITY.md` | Security posture — **must be kept current** (see task routing below) |

## Task routing

| You need to... | Start with |
|----------------|-----------|
| Change the data model | `packages/backend/src/db/schema.ts` → run `db:generate` |
| Change the rounding logic | `packages/shared/src/utils/rounding.ts` |
| Add an API endpoint | Add route in `packages/backend/src/routes/`, register in `app.ts` |
| Add a UI feature | `packages/frontend/src/pages/` or `components/` |
| Change the weekly goal setting | `packages/backend/src/routes/settings.ts` + `WeeklyGoalSetting.tsx` |
| Debug auth issues | `docs/integration/auth.md`, `packages/backend/src/middleware/auth.ts` |
| Deploy | `docs/operations/deployment.md` |
| Understand Docker layout | `docs/integration/docker.md` |
| Fix a recurring incident | `docs/memory/incidents.md` |
| Added a dependency / changed API / changed auth or storage | Update `SECURITY.md` (dep table, audit date, threat model, or "not done" list as appropriate) |

## API routes

| Route | Auth | Notes |
|-------|------|-------|
| `GET /api/health` | No | Docker healthcheck |
| `GET /api/info` | Yes | Version, repo URL, current user — drives Settings → About |
| `GET /api/settings` | Yes | Returns `{ weeklyGoalHours, roundingIncrementMinutes }` |
| `PUT /api/settings` | Yes | Update `{ weeklyGoalHours, roundingIncrementMinutes }` (increment: 30 or 60) |
| `GET /api/categories` | Yes | List user's categories, ordered by `sort_order ASC` |
| `POST /api/categories` | Yes | Create category; auto-assigns next `sort_order` |
| `PUT /api/categories/:id` | Yes | Update a category |
| `DELETE /api/categories/:id` | Yes | Delete a category |
| `PATCH /api/categories/reorder` | Yes | Bulk update `sort_order`; body: `[{id, sortOrder}]` |
| `GET /api/timer` | Yes | Active timer status |
| `POST /api/timer/start` | Yes | Start timer |
| `POST /api/timer/stop` | Yes | Stop timer |
| `GET /api/entries` | Yes | Time entries by date/week |
| `PATCH /api/entries/:id` | Yes | Update a time entry |
| `DELETE /api/entries/:id` | Yes | Delete a time entry |
| `GET /api/summary/weekly` | Yes | Weekly summary (goalMinutes comes from user_settings) |
| `POST /api/summary/round` | Yes | Apply end-of-day rounding (cap = user's weekly goal) |

## Deploy command

```bash
APP_VERSION=$(git describe --tags --abbrev=0) docker compose up -d --build
```

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

## Running tests

```bash
yarn workspace @time-keeper/shared test        # run unit tests (Vitest)
yarn workspace @time-keeper/shared test:watch  # watch mode
```

Tests live in `packages/shared/src/utils/rounding.test.ts`. They cover the core rounding algorithm (`computeRounding`): basic ceiling rounding, zero-minute no-ops, the configurable weekly cap, idempotency, and the configurable rounding increment (30 or 60 min). The `computeRounding` function accepts optional `weeklyGoalMinutes` (default 2400) and `roundingIncrementMinutes` (default 60) parameters.

Backend tests live in `packages/backend/src/routes/settings.test.ts` and cover getOrCreate, upsert, and Zod validation for both `weeklyGoalHours` and `roundingIncrementMinutes`.
