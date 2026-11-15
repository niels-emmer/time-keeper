# Memory Index — Time Keeper

> Read this file at the start of every coding session. It tells you what the project is, where critical files live, and where to go for deeper context.

## What this project is

A personal work-timer PWA for tracking time in categories from macOS and Android, then copying an end-of-week summary into Workday.

- One active timer at a time per user
- Configurable weekly goal (default 40 h) stored per user in `user_settings`
- Per-category targets — optional monthly targets, weekly targets converted to a month total, or one-time budgets that do not renew
- Billable categories — flag categories for billable vs non-billable reporting
- End-of-day rounding: minutes → nearest 30 or 60 min interval (configurable, default 60; capped at user's weekly goal)
- Auth: the app owns local accounts (password + optional TOTP, server-side sessions); Authentik forward auth is an optional `AUTH_MODE=proxy` mode

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
| `packages/backend/src/db/schema.ts` | All data types flow from here (`categories` now carries target cadence/minutes/start fields; `time_entries`, `user_settings`, and legacy `monthly_project_goals`) |
| `packages/shared/src/utils/rounding.ts` | Core business logic — the rounding algorithm |
| `packages/backend/src/middleware/auth.ts` | Auth boundary — Bearer tokens, server-side session cookies (`local`/`hybrid`), and `X-authentik-email` only with a trusted peer + matching `X-Internal-Token` in production; also gates token management |
| `packages/backend/src/routes/auth.ts` | Auth surface — public: `POST /login`, `POST /login/mfa`, `GET /status`, `POST /accept-invite`, `POST /reset`; session-scoped: `POST /logout`, `POST /logout-all`, `GET/PATCH/DELETE /me`, `POST /password`, `GET /sessions`, `DELETE /sessions/:id`, `DELETE /sessions/others`, `POST /mfa/enrol|confirm|disable`, `POST /mfa/recovery-codes/regenerate` |
| `packages/backend/src/lib/config.ts` | `AUTH_MODE` parsing (default `local`), production fail-loud validation for `SESSION_SECRET`/`MFA_ENCRYPTION_KEY`/`ADMIN_EMAIL`, ephemeral dev secrets |
| `packages/backend/src/services/userService.ts` | Identity resolution — `ensureProxyUser`, `ensureAdminFromEmail` (including the fresh-install first-admin bootstrap and one-time reset code), `seedDevAdmin` |
| `packages/backend/src/lib/totp.ts` | RFC 6238 / RFC 4226 TOTP on Node stdlib (`crypto` HMAC-SHA1, 30 s step, 6 digits, ±1 step window); `totp.test.ts` reproduces the RFC 6238 Appendix B vectors |
| `packages/backend/src/services/mfaService.ts` | MFA lifecycle — pending (encrypted) secret, confirm-before-activate, replay protection via `users.mfa_last_step`, hashed single-use recovery codes, disable/regenerate behind a password |
| `packages/backend/src/lib/mfaCrypto.ts` | AES-256-GCM for `users.mfa_secret_enc` with a unique IV per record and a verified auth tag; `MFA_ENCRYPTION_KEY` from env |
| `packages/backend/src/routes/admin.ts` | Admin surface — users list/create/update/delete, reset codes, invites, audit viewer. `requireAdmin` answers 404 for non-admins and fails with `mfa_enrolment_required` for a session admin without TOTP |
| `packages/backend/src/services/inviteService.ts` | Single-use 72h invite tokens — hashed at rest, atomic claim, one generic failure for unknown/used/expired |
| `packages/backend/src/services/accountService.ts` | Self-service lifecycle — profile update (username immutable), password change (revokes other sessions, rotates current), hard self-delete cascade with last-admin guard |
| `packages/backend/src/lib/passwordPolicy.ts` | Q22 password policy — 12 chars minimum, no username/email substrings, local denylist, no outbound calls. Re-exported from `@time-keeper/shared`, where the invite form's live checklist also reads it, so the API and the UI cannot drift |
| `packages/backend/src/lib/csrf.ts` | CSRF double-submit (`tk_csrf` cookie + `X-CSRF-Token`), constant-time compare, mounted centrally on `/api` |
| `packages/backend/src/lib/session.ts` | Server-side session core — create/verify/rotate/revoke, cookie flags, 5-minute freshness for sensitive actions |
| `packages/backend/src/services/authService.ts` | Local login (username or email), dummy-hash timing parity, explicit `PublicUser` serialiser, typed MFA-required state |
| `packages/backend/src/services/authLockout.ts` | Persisted per-IP (10/min) and per-account exponential backoff (5 failures → 1 min … 15 min cap) |
| `packages/backend/src/routes/settings.ts` | GET/PUT `/api/settings` — weekly goal hours + rounding increment |
| `packages/backend/src/services/summaryService.ts` | Builds weekly summary; reads weekly goal + rounding increment from DB |
| `packages/frontend/src/pages/Home.tsx` | Track tab shell — search input, recent/manual sections, pin state, and timer/category coordination |
| `packages/frontend/src/components/CategoryGrid.tsx` | Primary Track UX surface — category cards with active state, pin toggles, and quick-start affordances |
| `packages/frontend/src/components/QueryState.tsx` | Shared loading / error + Retry / empty boundary (`QueryState`) and dismissible mutation banner (`InlineError`) so a failed fetch never renders a blank panel |
| `packages/frontend/public/theme-init.js` | Pre-paint theme bootstrap loaded synchronously from `<head>`; a same-origin file so the production CSP can stay `script-src 'self'` |
| `packages/frontend/src/lib/track.ts` | Track screen utilities — local pin preferences, filtering, and ordering helpers for recent/manual category presentation |
| `packages/frontend/src/hooks/useRecentCategories.ts` | Derives recent category ordering from the current + previous ISO week entry data |
| `packages/frontend/src/pages/Monthly.tsx` | Monthly tab shell — month navigation plus the monthly overview, focus, and goal cards |
| `packages/frontend/src/components/MonthlyOverviewCard.tsx` | Monthly overview — headline metrics, projected vs actual by category, and billable vs non-billable hours |
| `packages/frontend/src/components/MonthlyFocusCard.tsx` | Monthly focus panel — surfaces the categories that need attention most |
| `packages/frontend/src/components/MonthlyGoalsCard.tsx` | Monthly Targets card — target-only category list, status chips, pace/budget guidance, and no inline editing |
| `packages/frontend/src/hooks/useMonthlySummary.ts` | Fetches the canonical monthly summary payload used by the Monthly tab |
| `packages/frontend/src/lib/monthly.ts` | Monthly helpers — month navigation, hours formatting, focus ranking, and status metadata |
| `packages/frontend/src/components/WeeklySummary.tsx` | Weekly tab — review panel, export-format picker + preview, editable hours-by-category table, day-log entry points, copy/download handoff formats, and round-week |
| `packages/frontend/src/components/DailyLogDialog.tsx` | Day-level entry history UI — inspect actual entries, navigate dates, edit/delete completed entries, and backfill missed work |
| `packages/macos_app/lib/tabs/weekly_tab.dart` | macOS Weekly tab — weekly totals table, inline cell editing, day-log launch points, and clipboard handoff |
| `packages/macos_app/lib/widgets/daily_log_dialog.dart` | macOS day-log dialog — inspect, edit, delete, and backfill the underlying daily entries |
| `packages/frontend/src/lib/weeklyExport.ts` | Weekly export utilities — format selection persistence plus CSV/plain-text/compact output builders |
| `packages/frontend/src/components/CategoryManager.tsx` | Category CRUD + drag-to-reorder + A-Z sort; billable flag and target editor in the settings dialog |
| `packages/frontend/src/components/WeeklyGoalSetting.tsx` | Settings UI for weekly goal (number input + slider) + rounding increment toggle |
| `packages/frontend/src/components/SessionExpiredOverlay.tsx` | Proxy-mode reload overlay, rendered by `AuthGate` when `AUTH_MODE=proxy` and no identity is present |
| `packages/frontend/src/components/AuthGate.tsx` | Session gate around the routes; renders the app, the local `Login` page, or the proxy reload overlay |
| `packages/frontend/src/pages/Login.tsx` | Local sign-in — username **or** email + password in one step, generic error copy, explicit MFA-required notice; also exports `LoginPage` for the public `/login` route (a signed-in visitor is sent to the app) |
| `packages/frontend/src/pages/Register.tsx` | Invite acceptance (outside `AuthGate`) — token from the URL, inline password policy, single generic failure copy |
| `packages/frontend/src/pages/Reset.tsx` | Password reset / first password (outside `AuthGate`) — `?code=` or typed code, inline policy, success → sign-in. This is also the `must_set_password` path for new, migrated and bootstrap accounts |
| `packages/frontend/src/pages/Account.tsx` | Self-service account — profile with a read-only username, password change, signed-in devices, typed-confirmation delete |
| `packages/frontend/src/components/AccountSetting.tsx` | Settings → Account card that links to `/account`, keeping Settings' existing sections unchanged |
| `packages/frontend/src/lib/theme.ts` | Pure theme utilities — `getStoredTheme`, `setStoredTheme`, `applyTheme`, `resolveTheme` |
| `packages/frontend/src/context/ThemeContext.tsx` | `ThemeProvider` + `useTheme` hook — manages light/dark/system preference and applies `.dark` class |
| `packages/frontend/src/lib/authContext.tsx` | Real session state — current user, role, MFA status, active mode, `refresh()`, and login/logout operations |
| `packages/frontend/src/lib/appStatusContext.tsx` | App-wide online/update state shared between the layout banners and Settings → About |
| `packages/frontend/src/lib/api.ts` | Base fetch wrapper — attaches `X-CSRF-Token`, throws `AuthError` (carrying the server `code`) on 401 and `ForbiddenError` on 403; `getErrorMessage` maps MFA/403 codes and bodyless statuses to readable copy and never returns an empty string |
| `packages/frontend/src/hooks/useOnlineStatus.ts` | Tracks online/offline transitions and recent reconnect state for in-app status banners |
| `packages/frontend/src/hooks/useServiceWorkerUpdate.ts` | Detects newer service workers, exposes update-ready state, and applies updates on demand |
| `packages/frontend/src/workers/timer.worker.ts` | Off-thread 1 s tick — keeps elapsed time accurate when tab is hidden |
| `packages/frontend/src/sw.ts` | Custom service worker (Workbox + persistent timer notification) |
| `packages/frontend/vite.config.ts` | Vite + VitePWA config (injectManifest strategy); must stay in sync with sw.ts |
| `docker-compose.yml` | Service wiring; nginx must pass `X-authentik-email`; publishes no host ports — NPM reaches `frontend:80` and `backend:3001` over `proxy-net` |
| `packages/backend/drizzle/` | Migration SQL files — committed, run on startup |
| `packages/shared/src/utils/rounding.test.ts` | Unit tests for the rounding algorithm (Vitest) |
| `packages/backend/src/routes/settings.test.ts` | Unit tests for the settings route (Vitest) |
| `packages/frontend/src/lib/__tests__/theme.test.ts` | Unit tests for theme utilities — 18 tests covering get/set/apply/resolve |
| `packages/frontend/src/lib/__tests__/track.test.ts` | Unit tests for Track helpers — filtering, recency, pin toggling, and sort modes |
| `packages/frontend/src/components/__tests__/CategoryGrid.test.tsx` | Frontend tests for Track cards — active state, pin toggles, and timer starts |
| `packages/frontend/src/components/__tests__/MonthlyGoalsCard.test.tsx` | Frontend tests for target status/pacing and one-time budget rendering |
| `packages/frontend/src/components/__tests__/MonthlyOverviewCard.test.tsx` | Frontend tests for monthly headline metrics and chart rendering |
| `packages/frontend/src/components/__tests__/MonthlyFocusCard.test.tsx` | Frontend tests for the monthly focus/attention panel |
| `packages/frontend/src/components/__tests__/DailyLogDialog.test.tsx` | Frontend tests for the day-log entry history UI and manual-entry creation flow |
| `packages/frontend/src/components/__tests__/WeeklySummary.test.tsx` | Frontend tests for weekly export preview, format switching, and copy workflow |
| `packages/frontend/src/hooks/__tests__/useServiceWorkerUpdate.test.tsx` | Frontend tests for PWA update-ready detection and reload flow |
| `packages/frontend/src/lib/__tests__/weeklyExport.test.ts` | Unit tests for weekly export builders and last-used export format persistence |
| `packages/backend/src/routes/categories.test.ts` | Backend tests for category billable + target validation and persistence |
| `packages/backend/src/routes/entries.test.ts` | Backend tests for manual-entry validation and entry persistence guardrails |
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
| Change category targets | `packages/backend/src/routes/categories.ts` + `CategoryManager.tsx` + `summaryService.ts` |
| Change monthly projections / billable charts | `packages/frontend/src/components/MonthlyOverviewCard.tsx` |
| Change billable eligibility per category | `packages/frontend/src/components/CategoryManager.tsx` (checkbox in edit dialog) |
| Debug auth issues | `docs/integration/auth.md`, `packages/backend/src/middleware/auth.ts` |
| Debug session-expiry UX | `packages/frontend/src/lib/api.ts` (`AuthError` / `ForbiddenError`), `src/lib/authContext.tsx`, `src/components/AuthGate.tsx` |
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
| `POST /api/auth/login` | No | Username **or** email + password; session + CSRF cookies on success; `mfa_required` (no cookie) for an enrolled account; 429 on lockout |
| `POST /api/auth/login/mfa` | No | Completes the challenge with a TOTP code (replay-protected, ±1 step) or a single-use recovery code; wrong codes use a separate, gentler counter so they cannot lock the password path |
| `POST /api/auth/mfa/enrol` | Session | Issues a **pending** secret + `otpauth://` URI; nothing is active until confirmation; 409 if already enrolled |
| `POST /api/auth/mfa/confirm` | Session | Verifies a code against the pending secret, then flips `mfa_enabled` and returns ten recovery codes once |
| `POST /api/auth/mfa/disable` | Fresh session | Password required; clears the secret and deletes every recovery code |
| `POST /api/auth/mfa/recovery-codes/regenerate` | Fresh session | Password required; replaces the whole set in one transaction |
| `GET /api/auth/status` | No | Public session probe — `{ authenticated, mode, user? }`; used by the frontend AuthGate |
| `POST /api/auth/logout` | Session | Revokes the presented session and clears both cookies (CSRF required) |
| `POST /api/auth/logout-all` | Session | Revokes every session for the account (CSRF required) |
| `GET /api/auth/me` | Session | Allowlisted account summary; never includes password/MFA secrets |
| `PATCH /api/auth/me` | Session | Display name and email only; `username` is rejected as immutable (400), a taken email is 409 |
| `POST /api/auth/password` | Fresh session | Current + new password; revokes every other session, rotates this one, writes `password_change` |
| `DELETE /api/auth/me` | Fresh session | Hard self-delete with password + typed username; cascades every user-scoped table; last admin is 409 |
| `GET /api/auth/sessions` | Session | The caller's own signed-in devices, current one flagged |
| `DELETE /api/auth/sessions/others` | Session | Sign out every other device for this account |
| `DELETE /api/auth/sessions/:id` | Session | Revoke one own session by its stored hash; another account's id is 404 |
| `POST /api/auth/accept-invite` | No | Invite-only registration; single generic failure for unknown/used/expired tokens; sets session + CSRF cookies; dedicated per-IP bucket (10 / 15 min) |
| `POST /api/auth/reset` | No | Redeem a single-use 60-minute admin-issued reset code and set a new password; clears `must_set_password`, revokes every session; 204 on success; single generic failure; dedicated per-IP bucket (10 / 15 min) |
| `GET /api/admin/users` | Admin | User table with entry counts; never includes hashes/secrets; 404 for non-admins |
| `POST /api/admin/users` | Admin + fresh | Create an account with an unusable password; returns a 60-minute reset code once |
| `PATCH /api/admin/users/:id` | Admin + fresh | Change role and/or enable/disable; disabling revokes sessions; last-admin guard |
| `DELETE /api/admin/users/:id` | Admin + fresh | Delete with `{ mode: 'cascade' \| 'reassign' }`; last-admin guard |
| `POST /api/admin/users/:id/reset` | Admin + fresh | Issue a new 60-minute reset code; invalidates the previous one |
| `POST /api/admin/invites` | Admin | Mint a single-use 72h invite; raw token returned once; 404 for non-admins, 403 `mfa_enrolment_required` for a session-authenticated admin without MFA (Q8) |
| `GET /api/admin/auth-events` | Admin | Audit viewer, newest first, 90-day retention pruned on read |
| `GET /api/info` | Yes | Version, repo URL, current user — drives Settings → About |
| `GET /api/settings` | Yes | Returns `{ weeklyGoalHours, roundingIncrementMinutes }` |
| `PUT /api/settings` | Yes | Update `{ weeklyGoalHours, roundingIncrementMinutes }` (increment: 30 or 60) |
| `GET /api/categories` | Yes | List user's categories, ordered by `sort_order ASC` |
| `POST /api/categories` | Yes | Create category; auto-assigns next `sort_order`; optional target config lives here |
| `PUT /api/categories/:id` | Yes | Update a category, including target cadence/minutes |
| `DELETE /api/categories/:id` | Yes | Delete a category |
| `PATCH /api/categories/reorder` | Yes | Bulk update `sort_order`; body: `[{id, sortOrder}]` |
| `GET /api/timer` | Yes | Active timer status |
| `POST /api/timer/start` | Yes | Start timer |
| `POST /api/timer/stop` | Yes | Stop timer |
| `GET /api/entries` | Yes | Time entries by date/week |
| `POST /api/entries` | Yes | Create a completed manual/backfilled time entry |
| `PATCH /api/entries/:id` | Yes | Update a time entry |
| `DELETE /api/entries/:id` | Yes | Delete a time entry |
| `GET /api/summary/weekly` | Yes | Weekly summary (goalMinutes comes from user_settings) |
| `GET /api/summary/monthly` | Yes | Canonical monthly summary with per-category targets, pace/budget status, projections, and billable split |
| `POST /api/summary/round` | Yes | Apply end-of-day rounding for a single date (cap = user's weekly goal) |
| `POST /api/summary/round-week` | Yes | Apply rounding to all 7 days of an ISO week; idempotent, skips already-rounded entries |
| `PATCH /api/summary/adjust-cell` | Yes | Set total minutes for a (date, categoryId) cell; creates/adjusts/deletes underlying time entries |
| `GET /api/tokens` | Interactive | List personal access tokens. Interactive = proxy header, or a session established within the last 5 minutes |
| `POST /api/tokens` | Interactive | Create a token; returns raw token once; label required; token expires after one year. A Bearer token gets 403 |
| `DELETE /api/tokens/:id` | Interactive | Revoke a token. A Bearer token gets 403 |

## Deploy command

```bash
docker compose up -d --build
```

## Screenshot conventions

`docs/screenshots/` holds nine PNGs at 390×844 @2x, dark theme: the four tabs
(`track.png`, `weekly.png`, `monthly.png`, `settings.png`) plus the auth surfaces
(`login.png`, `account.png`, `admin-users.png`, `reset.png`, `register.png`). They are generated by
`scripts/take-screenshots.mjs`, which signs in, enrols MFA if needed, seeds demo categories and
entries through the API, and then captures each screen.

```bash
# Playwright is deliberately not a project dependency (dev-only, downloads binaries).
mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm i playwright && npx playwright install chromium

PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs \
SCREENSHOT_BASE=http://localhost:5173 \
SCREENSHOT_PASSWORD='the dev admin password' \
node scripts/take-screenshots.mjs
```

- The dev admin must start without MFA; the script enrols it and prints
  `SCREENSHOT_TOTP_SECRET=…`. Pass that on later runs (MFA cannot be re-enrolled once on).
- Keep `MFA_ENCRYPTION_KEY` stable while capturing, or a backend restart invalidates the enrolment
  (see [local dev](../operations/local-dev.md)).
- The API allows 120 requests/minute; the script waits for headroom and honours `Retry-After`
  instead of capturing a half-loaded page.
- Demo data is only seeded when the account has no entries, so re-runs do not pile up. Clear
  `dev-data/time-keeper.db*` for a clean set.

### Screens and their required state

| Screen | Route | State the screenshot shows |
|---|---|---|
| Track | `/` | Signed in, seeded categories and a week of entries |
| Weekly | `/weekly` | Current ISO week with totals per category and day |
| Monthly | `/monthly` | Current month, targets, billable split |
| Settings | `/settings` | Categories with targets, work week |
| Login | `/login` | Signed out, `AUTH_MODE=local`, empty credentials form |
| Account | `/account` | Signed in **with MFA enrolled** — profile, password, 2FA, devices, delete |
| Admin users | `/settings` (scrolled to Users) | Admin with MFA enrolled; two accounts, one disabled, every action visible |
| Reset | `/reset?code=…` | Signed out, freshly issued code, empty password fields |
| Register | `/register?token=…` | Signed out, freshly minted unused invite, empty form |

The login MFA step is deliberately not a stored screenshot: it needs a live 30-second code, so it
would be stale the moment it was committed. Reproduce it by signing in with an MFA-enrolled account.

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
- `packages/backend/src/routes/settings.test.ts`, `packages/backend/src/routes/categories.test.ts`, `packages/backend/src/services/summaryService.test.ts` — cover settings validation/persistence, category billable+target validation, and monthly target derivation/one-time budget semantics.
- `packages/frontend/src/lib/__tests__/theme.test.ts`, `packages/frontend/src/components/__tests__/MonthlyGoalsCard.test.tsx`, `packages/frontend/src/components/__tests__/MonthlyOverviewCard.test.tsx`, `packages/frontend/src/hooks/__tests__/useServiceWorkerUpdate.test.tsx` — cover theme utilities, monthly target rendering, monthly overview rendering, and the PWA update prompt flow.

Vitest config for the frontend lives in `packages/frontend/vitest.config.ts` (jsdom environment, global APIs).
