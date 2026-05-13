# Memory Index — Time Keeper

> Read this file at the start of every coding session. It tells you what the project is, where critical files live, and where to go for deeper context.

## What this project is

A personal work-timer PWA for tracking time in categories from macOS and Android, then copying an end-of-week summary into Workday.

- One active timer at a time per user
- Configurable weekly goal (default 40 h) stored per user in `user_settings`
- Per-category monthly hour budgets (`monthly_project_goals`) — plan time allocation month-by-month
- Billable categories — flag categories for billable vs non-billable reporting
- End-of-day rounding: minutes → nearest 30 or 60 min interval (configurable, default 60; capped at user's weekly goal)
- Auth: Authentik embedded outpost via NPM forward auth (no auth code in the app)

## Critical files

| File | Why it matters |
|------|---------------|
| `AGENTS.md` | Routing index, canonical bootstrap order, and local Pi catalog for AI coding agents |
| `.pi/APPEND_SYSTEM.md` | Always-on Pi operating contract for this repository |
| `.pi-context` / `.pi-rules` / `CONTEXT.md` | Concise agent bootstrap context + durable workspace rules |
| `.pi/settings.json` | Declared Pi package/tooling expectations for local runs |
| `.pi/extensions/workflow-gate.ts` | Runtime workflow enforcement for explicit Research -> Plan -> Build -> Verify and `/rpbv-*` commands |
| `.pi/skills/` | Project-local focused guidance for governance, workflow hygiene, validation, and subagent routing |
| `.pi/agents/repo-governor.md` | Project-local governance helper agent |
| `.pi/agents/local-builder.md` | Project-local Ollama-backed builder for bounded, low-context tasks |
| `.pi/agents/local-reviewer.md` | Project-local Ollama-backed reviewer for bounded, low-context reviews |
| `packages/backend/src/db/schema.ts` | All data types flow from here (`categories`, `time_entries`, `user_settings`, `monthly_project_goals`) |
| `packages/shared/src/utils/rounding.ts` | Core business logic — the rounding algorithm |
| `packages/backend/src/middleware/auth.ts` | Auth boundary — validates Bearer tokens, trusts `X-authentik-email` only with a matching `X-Internal-Token` in production |
| `packages/backend/src/routes/settings.ts` | GET/PUT `/api/settings` — weekly goal hours + rounding increment |
| `packages/backend/src/services/summaryService.ts` | Builds weekly summary; reads weekly goal + rounding increment from DB |
| `packages/frontend/src/pages/Home.tsx` | Track tab shell — search input, sort mode toggle, pinned/recent sections, and timer/category coordination |
| `packages/frontend/src/components/CategoryGrid.tsx` | Primary Track UX surface — category cards with active state, pin toggles, and quick-start affordances |
| `packages/frontend/src/lib/track.ts` | Track screen utilities — local sort/pin preferences, filtering, and recent/manual/alphabetical ordering |
| `packages/frontend/src/hooks/useRecentCategories.ts` | Derives recent category ordering from the current + previous ISO week entry data |
| `packages/frontend/src/pages/Monthly.tsx` | Monthly tab shell — month navigation plus the monthly overview, focus, and goal cards |
| `packages/frontend/src/components/MonthlyOverviewCard.tsx` | Monthly overview — headline metrics, projected vs actual by category, and billable vs non-billable hours |
| `packages/frontend/src/components/MonthlyFocusCard.tsx` | Monthly focus panel — surfaces the categories that need attention most |
| `packages/frontend/src/components/MonthlyGoalsCard.tsx` | Monthly Goals card — per-category budgets, status chips, pace guidance, and inline goal editing |
| `packages/frontend/src/hooks/useMonthlySummary.ts` | Fetches the canonical monthly summary payload used by the Monthly tab |
| `packages/frontend/src/lib/monthly.ts` | Monthly helpers — month navigation, hours formatting, focus ranking, and status metadata |
| `packages/frontend/src/components/WeeklySummary.tsx` | Weekly tab — review panel, export-format picker + preview, editable hours-by-category table, day-log entry points, copy/download handoff formats, and round-week |
| `packages/frontend/src/components/DailyLogDialog.tsx` | Day-level entry history UI — inspect actual entries, navigate dates, edit/delete completed entries, and backfill missed work |
| `packages/frontend/src/lib/weeklyExport.ts` | Weekly export utilities — format selection persistence plus CSV/plain-text/compact output builders |
| `packages/frontend/src/components/CategoryManager.tsx` | Category CRUD + drag-to-reorder + A-Z sort; billable flag toggle in edit dialog |
| `packages/frontend/src/components/WeeklyGoalSetting.tsx` | Settings UI for weekly goal (number input + slider) + rounding increment toggle |
| `packages/frontend/src/components/SessionExpiredOverlay.tsx` | Full-screen overlay shown on 401/403; prompts user to log in again |
| `packages/frontend/src/lib/theme.ts` | Pure theme utilities — `getStoredTheme`, `setStoredTheme`, `applyTheme`, `resolveTheme` |
| `packages/frontend/src/context/ThemeContext.tsx` | `ThemeProvider` + `useTheme` hook — manages light/dark/system preference and applies `.dark` class |
| `packages/frontend/src/lib/authContext.ts` | React context carrying `sessionExpired` flag; set by global React Query error handler |
| `packages/frontend/src/lib/appStatusContext.tsx` | App-wide online/update state shared between the layout banners and Settings → About |
| `packages/frontend/src/lib/api.ts` | Base fetch wrapper; throws `AuthError` on 401/403 |
| `packages/frontend/src/hooks/useOnlineStatus.ts` | Tracks online/offline transitions and recent reconnect state for in-app status banners |
| `packages/frontend/src/hooks/useServiceWorkerUpdate.ts` | Detects newer service workers, exposes update-ready state, and applies updates on demand |
| `packages/frontend/src/workers/timer.worker.ts` | Off-thread 1 s tick — keeps elapsed time accurate when tab is hidden |
| `packages/frontend/src/sw.ts` | Custom service worker (Workbox + persistent timer notification) |
| `packages/frontend/vite.config.ts` | Vite + VitePWA config (injectManifest strategy); must stay in sync with sw.ts |
| `docker-compose.yml` | Service wiring; nginx must pass `X-authentik-email`; backend also exposes `127.0.0.1:38522` for api.* subdomain |
| `packages/backend/drizzle/` | Migration SQL files — committed, run on startup |
| `packages/shared/src/utils/rounding.test.ts` | Unit tests for the rounding algorithm (Vitest) |
| `packages/backend/src/routes/settings.test.ts` | Unit tests for the settings route (Vitest) |
| `packages/frontend/src/lib/__tests__/theme.test.ts` | Unit tests for theme utilities — 18 tests covering get/set/apply/resolve |
| `packages/frontend/src/lib/__tests__/track.test.ts` | Unit tests for Track helpers — filtering, recency, pin toggling, and sort modes |
| `packages/frontend/src/components/__tests__/CategoryGrid.test.tsx` | Frontend tests for Track cards — active state, pin toggles, and timer starts |
| `packages/frontend/src/components/__tests__/MonthlyGoalsCard.test.tsx` | Frontend tests for monthly goal status/pacing and goal editing |
| `packages/frontend/src/components/__tests__/MonthlyOverviewCard.test.tsx` | Frontend tests for monthly headline metrics and chart rendering |
| `packages/frontend/src/components/__tests__/MonthlyFocusCard.test.tsx` | Frontend tests for the monthly focus/attention panel |
| `packages/frontend/src/components/__tests__/DailyLogDialog.test.tsx` | Frontend tests for the day-log entry history UI and manual-entry creation flow |
| `packages/frontend/src/components/__tests__/WeeklySummary.test.tsx` | Frontend tests for weekly export preview, format switching, and copy workflow |
| `packages/frontend/src/hooks/__tests__/useServiceWorkerUpdate.test.tsx` | Frontend tests for PWA update-ready detection and reload flow |
| `packages/frontend/src/lib/__tests__/weeklyExport.test.ts` | Unit tests for weekly export builders and last-used export format persistence |
| `packages/backend/src/routes/categories.test.ts` | Backend tests for category billable validation and persistence |
| `packages/backend/src/routes/entries.test.ts` | Backend tests for manual-entry validation and entry persistence guardrails |
| `packages/backend/src/utils/monthlyGoalHelper.test.ts` | Backend tests for monthly-goal insert/update/lookup behavior |
| `SECURITY.md` | Security posture — **must be kept current** (see task routing below) |

## Task routing

| You need to... | Start with |
|----------------|-----------|
| Change the data model | `packages/backend/src/db/schema.ts` → run `db:generate` |
| Change the rounding logic | `packages/shared/src/utils/rounding.ts` |
| Add an API endpoint | Add route in `packages/backend/src/routes/`, register in `app.ts` |
| Add a UI feature | `packages/frontend/src/pages/` or `components/` |
| Change weekly-cell edit behaviour | `packages/frontend/src/components/WeeklySummary.tsx` + `PATCH /api/summary/adjust-cell` in `routes/summary.ts` |
| Change the theme / add colour tokens | `packages/frontend/src/index.css` (`:root` = light, `.dark` = dark), `src/lib/theme.ts` |
| Change the weekly goal setting | `packages/backend/src/routes/settings.ts` + `WeeklyGoalSetting.tsx` |
| Add per-category monthly hour goals | `packages/backend/src/utils/monthlyGoalHelper.ts` + `api.monthlyGoals` + `MonthlyGoalsCard.tsx` |
| Change monthly projections / billable charts | `packages/frontend/src/components/MonthlyOverviewCard.tsx` |
| Change billable eligibility per category | `packages/frontend/src/components/CategoryManager.tsx` (checkbox in edit dialog) |
| Debug auth issues | `docs/integration/auth.md`, `packages/backend/src/middleware/auth.ts` |
| Debug session-expiry UX | `packages/frontend/src/lib/api.ts` (`AuthError`), `src/lib/authContext.ts`, `src/components/SessionExpiredOverlay.tsx` |
| Debug timer accuracy / background tab | `packages/frontend/src/workers/timer.worker.ts`, `src/components/ActiveTimer.tsx` |
| Debug PWA / service worker / notifications | `packages/frontend/src/sw.ts`, `src/lib/notifications.ts`, `vite.config.ts` |
| Regenerate screenshot mockups | `docs/screenshots/` — see Screenshot conventions section below |
| Deploy | `docs/operations/deployment.md` |
| Understand Docker layout | `docs/integration/docker.md` |
| Fix a recurring incident | `docs/memory/incidents.md` |
| Added a dependency / changed API / changed auth or storage | Update `SECURITY.md` (dep table, audit date, threat model, or "not done" list as appropriate) |
| Changed dev setup, tooling, or style rules | Update `CONTRIBUTING.md` |

## API routes

| Route | Auth | Notes |
|-------|------|-------|
| `GET /api/health` | No | Docker healthcheck; also used by macOS app to verify connectivity |
| `GET /api/info` | Yes | Version, repo URL, current user — drives Settings → About |
| `GET /api/settings` | Yes | Returns `{ weeklyGoalHours, roundingIncrementMinutes }` |
| `PUT /api/settings` | Yes | Update `{ weeklyGoalHours, roundingIncrementMinutes }` (increment: 30 or 60) |
| `GET /api/categories` | Yes | List user's categories, ordered by `sort_order ASC` |
| `POST /api/categories` | Yes | Create category; auto-assigns next `sort_order` |
| `PUT /api/categories/:id` | Yes | Update a category |
| `DELETE /api/categories/:id` | Yes | Delete a category |
| `PATCH /api/categories/reorder` | Yes | Bulk update `sort_order`; body: `[{id, sortOrder}]` |
| `GET /api/settings/monthly-goals` | Yes | Fetch monthly budget for a category; query: `categoryId`, `monthYear` (YYYY-MM) |
| `POST /api/settings/set-monthly-goal` | Yes | Set/update monthly budget for a category; body: `{categoryId, monthYear, availableHours, availableMinutes}` |
| `GET /api/timer` | Yes | Active timer status |
| `POST /api/timer/start` | Yes | Start timer |
| `POST /api/timer/stop` | Yes | Stop timer |
| `GET /api/entries` | Yes | Time entries by date/week |
| `POST /api/entries` | Yes | Create a completed manual/backfilled time entry |
| `PATCH /api/entries/:id` | Yes | Update a time entry |
| `DELETE /api/entries/:id` | Yes | Delete a time entry |
| `GET /api/summary/weekly` | Yes | Weekly summary (goalMinutes comes from user_settings) |
| `GET /api/summary/monthly` | Yes | Canonical monthly summary with per-category goals, pace, projections, and billable split |
| `POST /api/summary/round` | Yes | Apply end-of-day rounding for a single date (cap = user's weekly goal) |
| `POST /api/summary/round-week` | Yes | Apply rounding to all 7 days of an ISO week; idempotent, skips already-rounded entries |
| `PATCH /api/summary/adjust-cell` | Yes | Set total minutes for a (date, categoryId) cell; creates/adjusts/deletes underlying time entries |
| `GET /api/tokens` | Yes (header-only) | List personal access tokens for the current user, including last-used and expiry metadata |
| `POST /api/tokens` | Yes (header-only) | Create a token; returns raw token once; label required; token expires after one year |
| `DELETE /api/tokens/:id` | Yes (header-only) | Revoke a token |

## Deploy command

```bash
docker compose up -d --build
```

## Screenshot conventions

`docs/screenshots/` contains four PNG screenshots (`track.png`, `weekly.png`, `monthly.png`, `settings.png`) captured at 390×844px using Chrome DevTools device emulation with html2canvas. To regenerate:

1. Start dev servers: `DEV_USER_ID=dev@example.com yarn workspace @time-keeper/backend dev` + `yarn workspace @time-keeper/frontend dev`
2. Seed sample data via the API (categories + an active timer)
3. Open Chrome, enable 390×844 device emulation, and undock DevTools to a separate window
4. For each page (`/`, `/weekly`, `/monthly`, `/settings`): inject html2canvas from CDN, capture `document.body`, POST the base64 PNG to a temporary `/api/dev/screenshot` endpoint on the backend (with a CORS header for localhost:5173), and save it to `docs/screenshots/{name}.png`
5. Update `README.md` if filenames change

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
yarn workspace @time-keeper/backend test       # backend route/helper tests
yarn workspace @time-keeper/frontend test      # frontend component/hook tests
```

Key test files:

- `packages/shared/src/utils/rounding.test.ts` — covers `computeRounding`, including ceiling rounding, zero-minute no-ops, the weekly cap, idempotency, and 30/60 minute increments.
- `packages/backend/src/routes/settings.test.ts`, `packages/backend/src/routes/categories.test.ts`, `packages/backend/src/utils/monthlyGoalHelper.test.ts` — cover settings validation and persistence, category billable validation and persistence, and monthly-goal insert/update/lookup behavior.
- `packages/frontend/src/lib/__tests__/theme.test.ts`, `packages/frontend/src/components/__tests__/MonthlyGoalsCard.test.tsx`, `packages/frontend/src/components/__tests__/MonthlyOverviewCard.test.tsx`, `packages/frontend/src/hooks/__tests__/useServiceWorkerUpdate.test.tsx` — cover theme utilities, monthly-goal rendering and editing, monthly overview rendering, and the PWA update prompt flow.

Vitest config for the frontend lives in `packages/frontend/vitest.config.ts` (jsdom environment, global APIs).
