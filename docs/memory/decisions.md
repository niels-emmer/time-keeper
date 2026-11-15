# Architecture Decision Log — Time Keeper

Short-form ADRs. Add new entries at the bottom.

---

## D-001: Drizzle ORM over Prisma

**Date:** 2026-02
**Status:** Accepted

Drizzle + better-sqlite3 was chosen over Prisma because:
- Drizzle has no binary query engine — simpler Docker builds, smaller images
- better-sqlite3 is synchronous, which matches SQLite's single-writer nature perfectly
- Drizzle schema is plain TypeScript — no separate `.prisma` DSL file
- Migrations are plain SQL files (committed in `drizzle/`) — fully auditable

## D-002: shadcn/ui + Tailwind CSS v3 over MUI/Chakra

**Date:** 2026-02
**Status:** Accepted

- shadcn/ui components are copied into the source tree — no dependency drift, no breaking upgrades from the library
- Tailwind provides consistent spacing/color without a runtime CSS-in-JS overhead
- Radix UI primitives (underlying shadcn/ui) are fully accessible
- Mobile-first design aligns well with the Android + macOS target
- Tailwind v3 chosen over v4: v4 ecosystem still maturing as of project start

## D-003: No auth code in the application

**Date:** 2026-02
**Status:** Accepted (implementation changed — see D-007)

The backend never validates tokens, manages sessions, or contacts an identity provider. Auth is enforced at the network/proxy level. The backend only reads a trusted HTTP header set by the upstream proxy. This keeps auth complexity out of the app and makes it testable without a running IdP.

## D-007: Authentik embedded outpost via NPM forward auth (replaces oauth2-proxy)

**Date:** 2026-02
**Status:** Accepted — supersedes original D-003 implementation

Initially planned as an oauth2-proxy sidecar. Changed during deployment when it became clear the target VPS already ran Authentik with an embedded proxy outpost, making oauth2-proxy redundant.

Authentik's embedded outpost integrates directly with Nginx Proxy Manager via the standard forward auth template. It sets `X-authentik-email` (and other `X-authentik-*` headers) on authenticated requests. NPM proxies to `localhost:38521` (frontend) only after the auth check passes.

Benefits over oauth2-proxy sidecar:
- No OIDC client ID/secret to manage in the codebase — zero secrets in the repo
- No additional Docker service — auth runs entirely in the existing Authentik stack
- Reuses the same NPM proxy template already protecting other apps on the VPS
- The nginx `proxy_set_header` pattern is identical to all other Authentik-protected apps

**Superseded (2026-11-14):** the trust assumption in this entry no longer holds, and the sentence "NPM proxies to `localhost:38521` (frontend)" is obsolete. Nginx stamped `X-Internal-Token` onto whatever `X-authentik-email` arrived, so the token proved *"this request passed through nginx"* rather than *"Authentik authenticated this request"* — anyone who could open a connection to the published port could authenticate as any email they chose (finding C-1). No host port is published any more; NPM reaches `frontend:80` over the external `proxy-net` network by service name, and the backend independently enforces a trusted-peer check. See **D-018**. The Authentik-outpost-over-NPM arrangement described above is still what runs.

## D-004: user_id denormalized into all tables

**Date:** 2026-02
**Status:** Accepted

Every row in `categories` and `time_entries` has a `user_id TEXT` column. There is no `users` table. This is intentional:
- Authentik owns user creation/deletion — the app doesn't need to know
- Queries are simple `WHERE user_id = ?` filters
- No JOIN needed to enforce data ownership
- If a user is removed from Authentik, their data stays in DB but is inaccessible

**Superseded by D-022** once the real-accounts work lands: the app will own identity and every data table will reference `users.id`. Until that migration ships, the text above describes the running system.

## D-005: Active timer = entry with null end_time

**Date:** 2026-02
**Status:** Accepted (enforcement amended — see D-020)

A running timer is represented as a `time_entries` row where `end_time IS NULL`. There is no separate `timers` table or state field. Stopping a timer = setting `end_time`. The single-timer invariant (I-003) is enforced by the service layer, not the DB schema.

**Amendment (2026-11-14):** "not the DB schema" is no longer true. The schema now carries a partial unique index, and `end_time` is no longer nullable in the update schema, because relying on the service layer alone left an API path that created a second open timer. See **D-020**.

## D-006: @tanstack/react-query for server state

**Date:** 2026-02
**Status:** Accepted

React Query provides:
- Automatic cache invalidation after mutations (stop timer → invalidate summary)
- Background refetching on window focus
- `refetchInterval: 5000` for the active timer query (keeps elapsed time fresh without manual polling code)
- Clean separation between server state (React Query) and local UI state (useState)

## D-008: @dnd-kit for drag-to-reorder categories

**Date:** 2026-02
**Status:** Accepted

`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` were chosen over alternatives (react-beautiful-dnd, react-dnd, HTML5 native drag) because:
- Works on both pointer (mouse) and touch (Android) via separate sensors — critical for the Android target
- Fully accessible: keyboard-navigable, respects `prefers-reduced-motion`
- Headless — no opinions on markup or styling; integrates cleanly with shadcn/ui cards
- react-beautiful-dnd is no longer maintained; @dnd-kit is its spiritual successor
- Native HTML5 drag API does not fire on mobile

Optimistic updates are applied via `qc.setQueryData` before the `PATCH /api/categories/reorder` mutation fires, giving instant visual response. `onSettled` invalidation re-syncs with the server.

## D-009: Vitest for unit tests in @time-keeper/shared

**Date:** 2026-02
**Status:** Accepted

Vitest was chosen over Jest because:
- Native ESM support — the codebase uses `"type": "module"` throughout; Jest requires additional transforms
- Vite-native: same config as the frontend build toolchain; zero extra config files
- API-compatible with Jest (same `describe`/`it`/`expect` surface) — easy migration path
- Fast cold start; no separate Babel transform pipeline

Tests are scoped to `@time-keeper/shared` only, as it contains the pure business logic (`computeRounding`) that is most valuable to test in isolation. Backend routes and frontend components are tested via manual Docker validation for now.

## D-010: Per-user weekly goal stored in user_settings table

**Date:** 2026-02
**Status:** Accepted

The 40 h weekly cap was previously a hardcoded constant (`WEEKLY_GOAL_MINUTES = 2400`) in `@time-keeper/shared`. Replaced by a per-user `weekly_goal_hours` column in a new `user_settings` SQLite table (upserted on first access, default 40).

Why a DB table rather than an env variable or localStorage:
- Per-user: different users on the same instance can have different goals
- Server-authoritative: the rounding algorithm runs server-side; the cap must come from the same source of truth
- Consistent with the existing pattern (`user_id` on every table, no external config files)

The `computeRounding()` function now accepts an optional `weeklyGoalMinutes` parameter (default 2400) so existing unit tests continue to work without changes, and callers that need the user value pass it explicitly.

The frontend reads the goal via `GET /api/settings` and exposes a number input + range slider (0–40) in Settings → Work week. Changes are saved on blur/release and invalidate both the `settings` and `summary` React Query caches.

## D-011: SECURITY.md is a living document, maintained by every agent session

**Date:** 2026-02
**Status:** Accepted

`SECURITY.md` must reflect the current state of the codebase at all times, not just at the moment it was created. This is enforced as a standing requirement in `AGENTS.md`.

Triggers for an update (any one is sufficient):

| Change | Section to update |
|--------|-----------------|
| New npm dependency | Dependency table; re-run `yarn npm audit`; update audit date |
| Dependency removed or upgraded | Same |
| New or removed API endpoint | Threat model (authenticated surface) |
| Auth or middleware change | Authentication section |
| Schema or persistence change | Data storage section |
| New capability not yet audited | "What has not been done" list |

If none of these apply in a session, explicitly confirm before closing — do not silently skip.

Rationale: security docs that are written once and never updated give visitors a false sense of confidence. A stale doc is worse than none because it misleads. Keeping it in sync with `AGENTS.md` makes maintenance automatic rather than optional.

## D-012: Configurable rounding increment (30 or 60 min) stored in user_settings

**Date:** 2026-02
**Status:** Accepted

The rounding increment (previously hardcoded to 60 min = 1 h) is now a per-user setting stored in `user_settings.rounding_increment_minutes` (integer, NOT NULL DEFAULT 60). Valid values are 30 or 60 — enforced at the DB default level and via Zod validation on the `PUT /api/settings` route (`z.union([z.literal(30), z.literal(60)])`).

Why the same `user_settings` table (not env var / localStorage):
- Per-user: different users on the same instance may want different precision
- Server-authoritative: `computeRounding()` runs server-side; the increment must come from the same source as the weekly goal
- Consistent with the existing `weeklyGoalHours` pattern added in D-010

`computeRounding()` in `@time-keeper/shared` now accepts a fourth optional parameter `roundingIncrementMinutes` (default `DEFAULT_ROUNDING_INCREMENT = 60`) so all existing tests continue to pass unchanged.

The frontend exposes the setting as a two-button toggle ("30 min" / "60 min") immediately below the weekly goal slider in the Settings → Work week card. Selecting either option fires an immediate PUT (the entire settings object is sent — both `weeklyGoalHours` and `roundingIncrementMinutes` — because the backend validates the full body).

## D-013: Global session-expiry detection in the frontend

**Date:** 2026-02
**Status:** Accepted

When the Authentik session expires overnight (or due to a token timeout), the PWA's periodic React Query fetches continue running but all API calls return 401. Previously, the UI silently showed empty state — the user had no indication the session had ended.

**Solution:** A dedicated `AuthError` class (thrown by `api.ts` on 401/403) is caught by a global React Query cache subscriber in `main.tsx`. Once any query or mutation surfaces an `AuthError`, a React state flag `sessionExpired` is set on the `AuthContext` (provided above `<App>`). `App.tsx` renders a full-screen `SessionExpiredOverlay` covering the entire app, with a "Log in again" button that does `window.location.href = '/'` — a hard navigation that NPM + Authentik's forward-auth intercepts and redirects to the Authentik login page.

Why a hard navigation (not `navigate('/')` from React Router):
- A client-side route change stays within the SPA and never reaches NPM/Authentik
- `window.location.href = '/'` issues a real HTTP GET, which NPM forward-auth intercepts and redirects to the Authentik login page when the session cookie is absent

Why a full-screen overlay (not a toast):
- The PWA is unusable when unauthenticated; a dismissible toast would leave the user on an empty screen with no path forward
- The overlay is intentionally not dismissible — the only valid action is to re-authenticate

Retry behaviour: `AuthError` disables React Query's retry logic (`retry: false` when error is `AuthError`) so the app stops hammering the backend with doomed requests after the session ends.

No new npm dependencies were added.

**Amendment (2026-03-12):** The original implementation had two gaps, both fixed in INC-007:
- The Workbox service worker was serving the cached app shell on every navigation request, preventing Authentik from issuing its `302 → login` redirect. Fixed by registering `NetworkFirst` (3 s timeout) for navigation requests before `precacheAndRoute`.
- Forward-auth proxies return `302` (not `401`) for unauthenticated API calls. `fetch()` with the default `redirect: 'follow'` silently chased the redirect and never surfaced an `AuthError`. Fixed by adding `redirect: 'manual'` to all API calls and treating `res.type === 'opaqueredirect'` as `AuthError(302)`.

## D-014: Light / dark / system theme — client-side only, localStorage

**Date:** 2026-02
**Status:** Accepted

The app shipped dark-only. A three-way preference (Light / Dark / Follow System) was added as a purely client-side feature.

**Storage:** `localStorage['time-keeper-theme']` ('light' | 'dark' | 'system'). Default when absent: 'system'.

**Mechanism:** Tailwind's `darkMode: ['class']` strategy is used. The `.dark` class is toggled on `<html>` by `applyTheme()` in `src/lib/theme.ts`. A `ThemeProvider` in `src/context/ThemeContext.tsx` wraps the whole app, tracks preference in React state, and listens to the `prefers-color-scheme` media-query event so a 'system' selection responds to OS changes in real time.

**Flash prevention:** A tiny inline `<script>` in `<head>` (before any CSS or JS loads) reads localStorage and conditionally adds `class="dark"` to `<html>`. This runs synchronously so the correct theme is applied before the first paint, eliminating any flash-of-wrong-theme.

**CSS variables:** `index.css` now defines `:root` as the light palette and `.dark` as the original dark palette. All other Tailwind / shadcn/ui colour references (`bg-background`, `text-muted-foreground`, etc.) automatically resolve to the active palette via `hsl(var(--name))`.

**PWA manifest:** `theme_color` updated to the primary brand colour (`#4f5aea`), which is neutral between the two schemes. Two `<meta name="theme-color">` tags with `media` attributes in `index.html` control the browser chrome colour per scheme while browsing (Chrome 76+ supports this).

**No backend changes:** theme is a display preference with no effect on server-side logic.

Why localStorage rather than the `user_settings` table (used for weekly goal and rounding increment):
- Theme is a device/browser preference — the same user might want different themes on phone vs desktop
- No server round-trip needed; the preference is applied synchronously on first paint
- Storing it server-side would require a `GET /api/settings` response before the correct theme could be applied, causing a flash

**Amendment (2026-11-14) — CSP and the theme bootstrap:** the inline `<script>` described above was blocked in production, because `nginx.conf` ships `script-src 'self'` with no `'unsafe-inline'` and no hash (finding M-1). The flash-of-wrong-theme fix had therefore been dead in production while still working in dev, where Vite sends no CSP.

Decision: **move the snippet out of `index.html` into a same-origin file, `packages/frontend/public/theme-init.js`, loaded by a synchronous `<script src="/theme-init.js">` in `<head>`.** `script-src 'self'` covers it unchanged.

Why a same-origin file rather than adding `'sha256-…'` to the policy:
- A hash has to be recomputed every time the snippet changes, and minification can alter it — a silent regression the browser reports only in the console
- A nonce requires templating the served HTML, which this static nginx setup does not do
- `'self'` stays strict; no `'unsafe-inline'` is ever added, so an injected inline script still cannot run

The script must stay synchronous and in `<head>` — it has to run before first paint or the flash returns. `default-src 'self'`, `object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'none'` are unchanged.

## D-015: Bearer token auth for native clients (api.* subdomain)

**Date:** 2026-04-07
**Status:** Accepted

Added a second authentication path alongside the existing Authentik header auth, to support a native macOS status bar app that cannot participate in browser-based OIDC/forward-auth flows.

**Design:**
- `api_tokens` table stores SHA-256 hashes of tokens (never the raw tokens)
- Raw tokens are 32-byte `randomBytes` encoded as base64url (256-bit entropy, ~43 chars)
- The `authMiddleware` checks `Authorization: Bearer <token>` first, then falls through to `X-authentik-email`
- A new `req.authMethod: 'header' | 'token'` field distinguishes the two paths
- Token management endpoints (`GET/POST/DELETE /api/tokens`) require `authMethod === 'header'` — a Bearer token cannot create, list, or revoke tokens (see I-009)
- The backend is also exposed on port `127.0.0.1:38522` so NPM can proxy `api.*` directly to it without going through the frontend nginx (which is the Authentik forward-auth hop)

**Why Option A2 (separate subdomain) over A1 (bypass path on same host):**
- Cleaner separation of concerns — the Authentik-protected domain remains 100% behind the proxy
- Easier to configure in NPM (separate proxy host, no location block surgery)
- Clear operational mental model: `timekeeper.*` = browser/PWA, `api.*` = native app

**Security properties:**
- HTTPS enforced by NPM (Let's Encrypt cert on the api subdomain)
- Port 38522 bound to `127.0.0.1` — only the local NPM host can reach it
- 120 req/min rate limit applies (existing `express-rate-limit` on all `/api/` routes)
- Tokens are one-way hashed — a DB breach does not expose usable tokens
- Token management is Authentik-only — a leaked token cannot bootstrap more tokens

**No new npm dependencies:** Node.js built-in `crypto` module used for SHA-256 and `randomBytes`.

**Superseded (2026-11-14):** the two bullets that describe the backend as "exposed on port `127.0.0.1:38522`" are obsolete — no host port is published at all. NPM reaches `backend:3001` over the external `proxy-net` Docker network by service name, and publishing a port would reopen finding C-1. See **D-018**. Everything above about token generation, hashing, expiry and `requireHeaderAuth` still holds.

## D-016: Editable cells in the weekly summary table

**Date:** 2026-04-12
**Status:** Accepted

The weekly overview table was read-only. Clicking any data cell in a category row now opens an inline `<input type="number">` pre-filled with the current hours. Totals (per-day and per-week) update live as the user types, before the value is saved.

**Backend approach** — `PATCH /api/summary/adjust-cell` with `{ date, categoryId, minutes }`:
- Minutes = 0 → delete all entries for that day/category
- No entries exist → create a single synthetic entry anchored at 09:00 UTC with `endTime = startTime + minutes * 60000`
- Entries exist → adjust the last entry's `endTime` so the total matches the requested value (all other entries are left unchanged)

Category ownership is validated before any modification.

**Frontend approach** — two pieces of state:
1. `editingCell: { categoryId, date, value }` — which cell has a live text input
2. `localOverrides: Map<string, number>` — key `${categoryId}-${date}`, value minutes — populated as the user types, so derived totals recalculate immediately

On save, the override stays visible during the in-flight request; it is cleared once `invalidateQueries` delivers fresh server data. On cancel (Escape), the override is removed and the cell reverts to the server value.

**Why adjust the last entry rather than replacing all entries:**
- Preserves real start/end times on earlier entries — useful audit trail of when work actually happened
- Simple, deterministic, and reversible — the user can set any value without losing original data structure

**Trade-off:** if the sum of all-but-last entries already exceeds the requested total, the last entry is clamped to 0 duration (the cell would still show less than requested). Entering 0 explicitly deletes all entries cleanly.

**No new npm dependencies.**

## D-017: Per-category targets live on categories, not month-scoped goal rows

**Date:** 2026-05-18
**Status:** Accepted

Category target configuration moved into Settings → Edit Category and is now stored directly on `categories` via:
- `target_cadence` (`monthly` | `weekly` | `one_time` | null)
- `target_minutes` (integer minutes | null)
- `target_started_at` (UTC ISO timestamp | null, used only for one-time budgets)

Why this replaced month-tab editing as the canonical flow:
- The configuration belongs to the category itself, so Settings is the simpler and more discoverable home
- Weekly-derived monthly targets and one-time budgets cannot be modelled cleanly as month-scoped rows alone
- A one-time budget must persist across month boundaries without resetting, which requires a durable start boundary rather than a new row every month

Monthly summary behaviour now derives an effective month target from the category settings:
- `monthly` → use the configured minutes directly
- `weekly` → convert to a month-specific target using the viewed month length
- `one_time` → compare the fixed budget against cumulative spend since `target_started_at`

Migration note: existing `monthly_project_goals` rows are backfilled into category targets as `monthly` targets. The legacy table remains in the schema for now, but it is no longer the canonical source for the Monthly tab.

## D-018: The auth trust boundary is enforced in the backend, not by nginx

**Date:** 2026-11-14
**Status:** Accepted — supersedes the trust model in D-007; amends I-001 and I-007

**The problem (finding C-1).** `packages/frontend/nginx.conf` stamped `X-Internal-Token` onto whatever `X-authentik-email` header arrived. The shared secret therefore proved *"this request passed through nginx"*, not *"Authentik authenticated this request"*. Anyone who could open a connection to the published frontend port could send `X-authentik-email: victim@example.com` and be authenticated as that user. The secret was on the wrong side of the trust boundary: it defended the backend against direct access while the browser path's trust anchor (nginx) was itself reachable.

**Decision — three layers, all required:**

1. **Publish no host port.** `docker-compose.yml` binds nothing. Both containers attach only to the external `proxy-net` network, and NPM (also on that network) reaches `frontend:80` and `backend:3001` by Docker service name. Every document that told operators to publish `38521`/`38522` was wrong and has been corrected.
2. **Reject untrusted peers in the backend.** `X-authentik-email` is honoured only when `req.socket.remoteAddress` — never `req.ip`, which Express derives from the client-controlled `X-Forwarded-For` — is loopback, a private range, or inside the optional `TRUSTED_PROXY_CIDRS` allowlist. A public peer presenting the header gets 401. `TRUSTED_PROXY_CIDRS` extends the built-in ranges rather than replacing them, so the safe default survives an unset or blank variable.
3. **Keep the internal token as fail-closed defence in depth.** In production the request must also carry a matching `X-Internal-Token`; missing `INTERNAL_PROXY_SECRET` refuses to boot.

**Consequences:**
- The peer allowlist, not the shared secret, is what makes the header path safe. It is a property of code, so it is unit-tested (`isTrustedProxyPeer`, `isTrustedProxyRequest`) instead of being a firewall promise.
- **Publishing a port reopens C-1.** The allowlist does not save you there: the backend would see nginx's private address as the peer, which is exactly a trusted peer. This is why layer 1 is not optional.
- The Bearer path is deliberately unaffected: a valid token is accepted from any peer, because the token is the credential.
- C-1 cannot be *closed* from inside the repository — the deployed topology is operator state. It is mitigated in code and stays open until someone runs the off-host `curl` regression check.

**Not chosen:** replacing the header with an HMAC-signed assertion (`user|ts` signed with a server-side key), which would make safety independent of network topology. It needs a signer on the NPM/Authentik side, so it is out-of-repo work and remains a future option. Identity-header normalisation (trim/lowercase/length cap, duplicate-header rejection) is also not implemented; both are recorded in `SECURITY.md` under "What has not been done".

## D-019: Bucket entries by the user's local day; keep UTC storage

**Date:** 2026-11-14
**Status:** Accepted — amends how I-004 is applied

**The problem (finding H-3).** Storage was UTC (correct, per I-004) but *bucketing* was also UTC, while entry creation converted a **local** `datetime-local` value. In Europe/Amsterdam, work logged between 00:00 and 02:00 local was stamped with the previous UTC date: an entry added at 00:30 on 15 November appeared under 14 November and vanished from the day log that had just been used to create it. Weekly columns, rounding windows and month boundaries all inherited the shift. The bug was a *definition* split — "what is a day?" had two answers — not a DST problem.

**Decision:** keep UTC storage, bucket by a **per-user local day**.

- `user_settings.timezone` (migration `0010`) stores an IANA zone name such as `Europe/Amsterdam`, default `UTC`.
- `localDayKey(isoUtc, timeZone)` / `localDayBounds(dayKey, timeZone)` live in `@time-keeper/shared` and are implemented on `Intl.DateTimeFormat`, so DST transitions come from the timezone database rather than fixed offsets.
- The four bucketing sites route through those helpers: the day read in `routes/entries.ts`, weekly grouping and month bounds in `summaryService.ts`, and the rounding day window in `roundingService.ts`.
- Settings exposes a timezone selector.

**How this amends I-004:** I-004 governs *storage* and is unchanged — timestamps are still UTC ISO 8601. What changed is that "a day" is now the user's local day, not a UTC slice. Do not "fix" bucketing back to UTC string slicing; that reintroduces H-3. A user who never picks a zone keeps the old UTC behaviour, because the default is `UTC` — which is what makes the change reversible and preserves an untouched install.

Tests pin the interesting cases: 00:30 and 23:30 local, a spring-forward and a fall-back day (23 and 25 hours, still summing correctly), and a month boundary at 00:30 local.

## D-020: The database enforces one open timer per user

**Date:** 2026-11-14
**Status:** Accepted — amends D-005

**The problem (finding H-1).** D-005 said the single-timer invariant was enforced by the service layer. It was not enforced anywhere: `updateEntrySchema.endTime` was `.nullable()`, and `assertEntryRange` returned early on `null`, so `PATCH /api/entries/:id {"endTime": null}` converted any completed entry into a *second* running entry. `getActiveTimer` then returned an arbitrary one of them, and the summaries exclude open entries, so hours silently disappeared while the Track screen showed an unrelated timer.

**Decision:** enforce it in the schema, not by convention.
- `updateEntrySchema.endTime` is no longer nullable — a completed entry cannot be reopened into a running one.
- Migration `0009` adds a partial unique index: `idx_entries_one_open_per_user ON time_entries (user_id) WHERE end_time IS NULL`. No code path — including a future one, or a direct `INSERT` — can create a second open row.
- `startTimer()` still auto-stops the current timer before inserting, so the normal flow remains a single row transition.

**Consequence:** the service-layer behaviour described in D-005 is now a convenience, and the database is the guarantee. A second open row fails at write time rather than being tolerated.

## D-021: Rounding caps the bonus and never discards real work

**Date:** 2026-11-14
**Status:** Accepted — amends I-006

**The problem (finding M-6).** I-006 claimed the rounded total could never exceed the weekly goal. The implementation only caps the *rounding bonus*: with a 2400-minute goal, 2000 minutes already logged, and a 600-minute raw day, the result is 600 and the week reaches 2600. The invariant and the code disagreed, and the tests encode the code's behaviour.

**Decision:** the code is right and the invariant was wrong — you cannot un-work time.
- Rounding may add a bonus only up to the remaining weekly headroom.
- It never reduces a category below its **raw** minutes; only bonus can be removed.
- When the raw day alone overruns the headroom the bonus is zero and the result reports `weekWouldExceed: true`. The API surfaces the overrun instead of clamping real work.

**I-006 is restated** in those terms, and the docstring was aligned ("largest-first" removal, matching the sort). **No logic changed** — the rounding algorithm is explicitly out of scope for these fixes.

**Consequence for readers:** a week can legitimately show more than the goal. That is the user's real time, and it is reported, not hidden.

## D-022: The app owns identity — real accounts, `users` table with UUID keys

**Date:** 2026-11-14
**Status:** Implemented (2026-11-15) — supersedes the "no users table" invariant (I-008) and D-004

Identity moves into the application. A `users` table with a UUID primary key becomes the owner of every record: every data table (`categories`, `time_entries`, `user_settings`, `api_tokens`, …) gets a foreign key to `users.id` instead of the denormalised `user_id TEXT` email column.

Why this reverses the earlier "Authentik owns user creation/deletion" position:
- Sessions, password change, MFA enrolment and recovery, invites, and destructive account actions cannot be expressed while another system owns the identity record
- A foreign key to a real row makes "data belongs to a user that exists" a database guarantee rather than a convention
- Deleting an account becomes a schema-level operation (see D-028) instead of an orphaned-data problem

This supersedes I-008 in `docs/memory/invariants.md`; the invariant must be rewritten in the same change that lands the migration, not before.

## D-023: Authentik coexistence via `AUTH_MODE=local|proxy|hybrid`

**Date:** 2026-11-14
**Status:** Implemented (2026-11-15)

`AUTH_MODE` selects how requests are authenticated:
- `local` — the app's own sessions (D-024). Becomes the **default at cutover**.
- `proxy` — the existing Authentik forward-auth header path (D-007 / D-018), unchanged and fully supported.
- `hybrid` — both are accepted, for a staged migration window.

Proxy header auth is retained as a supported mode rather than deleted, so rolling back the cutover is a configuration change, not a code revert. The trust rules in D-018 continue to apply whenever the proxy mode is active: no published port, trusted peer, internal token.

## D-024: Session authentication with server-side sessions

**Date:** 2026-11-14
**Status:** Implemented (2026-11-15)

Local auth uses **server-side sessions**: an opaque session identifier is held in an `httpOnly`, `Secure`, `SameSite=Lax` cookie, with the session record in SQLite (consistent with I-005 — no new stateful store).

Cross-site request forgery is handled with a **CSRF double-submit token**: a per-session token is issued to the client and must be echoed in a request header, and the two are compared server-side.

**Accepted risk:** this **reintroduces a CSRF surface that the header-only design did not have** — ambient cookie credentials are sent automatically by browsers, which is exactly what `protectBrowserMutations` (`Origin`/`Referer` checking) was able to sidestep. The double-submit token plus the existing same-origin check are the mitigations, and the resulting CSRF threat **must be added to `SECURITY.md`'s threat model** as part of the implementing change. It is not a reason to avoid sessions; it is a cost of the decision, recorded here so it is not rediscovered later.

## D-025: Password storage — Node `crypto.scrypt`, versioned hash prefix

**Date:** 2026-11-14
**Status:** Implemented (2026-11-15)

Passwords are hashed with `crypto.scrypt` from Node's built-in `crypto` module. **No new dependency** is added — no bcrypt, no argon2 native addon, consistent with the project's preference for the standard library and its aversion to extra native code.

Stored hashes carry a **versioned prefix** so parameters can change without invalidating existing accounts: the prefix identifies the algorithm and cost parameters used, and a successful login with an older prefix is the opportunity to re-hash transparently.

## D-026: MFA — TOTP plus recovery codes, mandatory for admins

**Date:** 2026-11-14
**Status:** Implemented (2026-11-15)

Second factor is **TOTP** (RFC 6238) with a set of **single-use recovery codes** for device loss.

- **Mandatory for admin accounts.** An admin without a second factor cannot exist.
- The TOTP shared secret is **encrypted at rest with AES-256-GCM**, so a database copy does not hand over every second factor. The key is deployment configuration, not stored beside the ciphertext.

## D-027: Registration is invite-only

**Date:** 2026-11-14
**Status:** Implemented (2026-11-15)

There is **no public registration endpoint**, and none will be built. Accounts are created by an admin-issued invite. This keeps the instance closed by default and avoids the account-enumeration and abuse surface that a public signup form brings to a self-hosted tool.

## D-028: Destructive account actions

**Date:** 2026-11-14
**Status:** Implemented (2026-11-15)

- **Self-delete cascades.** A user deleting their own account removes their data via the foreign keys from D-022; no orphaned rows are left behind.
- **Admin-delete chooses the disposition.** An admin deleting another account picks either **cascade** (delete the data) or **reassign** (move it to another user). Data is never silently destroyed or silently orphaned.
- **Last-admin guards.** The final admin account cannot be deleted or demoted, so the instance cannot be locked out of administration.
- **5-minute re-auth freshness** for sensitive actions (password change, MFA changes, account deletion). A sensitive action requires a credential check within the last five minutes, so a stolen session cannot be escalated into a permanent takeover.

## D-029: Session lifetime and freshness policy

**Date:** 2026-11-15
**Status:** Implemented — realises D-024 and Q7/Q17

Every local login creates a row in `sessions`. The browser holds an opaque 32-byte id in the `tk_session` cookie; the database stores only its SHA-256, so a database copy does not hand over live sessions.

- **Idle timeout 14 days.** `last_seen_at` slides `expires_at` forward on use.
- **Absolute cap 90 days.** `absolute_expires_at` is set at creation and never moves, so a continuously used session still ends.
- **Rotation.** The session id is replaced on login, on MFA completion, and on password change. This defeats fixation: an id planted before authentication is never the id that authenticates.
- **Revocation is immediate.** "Sign out", "sign out other devices", an admin disabling an account, and a password reset all delete rows; the next request with that cookie is 401.
- **Five-minute freshness.** Password change, token minting, role change, account deletion and MFA disable require a session established (or re-authenticated) within five minutes. A stale session gets 403 `reauthentication_required`; the UI asks for a fresh sign-in. Proxy-header identities are exempt because Authentik re-authenticates every hop; Bearer tokens are refused outright.

**Why these numbers:** 14/90 keeps a personal device signed in for weeks without making a stolen cookie permanent. The freshness window is short enough that an unattended laptop cannot be used to change a password, and long enough that the normal "open Account, change password" flow does not re-prompt.

**Consequences:** sessions are part of the database backup (I-005), so restoring a backup restores the sessions that were live at snapshot time. That is acceptable for a single-file self-hosted app; revoking all sessions is one admin action if needed.

## D-030: MFA enforcement and the TOTP-vs-password lockout separation

**Date:** 2026-11-15
**Status:** Implemented — realises D-026 and Q8

Second factor is TOTP (RFC 6238) with ten single-use recovery codes.

- **Admins must enrol.** A session-authenticated administrator without MFA gets 403 `mfa_enrolment_required` on every admin route, not a 404 — the person is legitimate and the correct answer is "go and enrol". Proxy-header administrators are exempt because Authentik owns MFA on that path; demanding a second factor its login never asked for would lock the deployed proxy admin out.
- **Verification window is ±1 step (30 s).** `users.mfa_last_step` stores the last accepted step, so a replayed code is rejected. The accepted step is bumped in the same transaction that issues the session.
- **Recovery codes are single-use and hashed.** Ten are shown once at confirmation; only hashes are stored; each is deleted on use. Regeneration replaces the whole set behind a password check.
- **Wrong codes have their own counter.** A wrong TOTP or recovery code increments an MFA-specific failure counter; it does **not** increment the password lockout counter and cannot lock the password path. Conversely, a wrong password uses the password counter. This separation is the point: otherwise anyone who knows a username could deny service by sending bad codes, and a user fumbling an authenticator would be locked out of the thing that could recover them.
- **Enrolment is confirm-before-activate.** A pending secret is stored encrypted but does not set `mfa_enabled`; only a valid code against it does. Disabling requires the password and a fresh session.

**Why TOTP rather than WebAuthn:** every phone supports it and there is no browser ceremony. It is phishable, which is recorded as an accepted residual in `SECURITY.md`; WebAuthn is Phase G.

**Consequences:** `MFA_ENCRYPTION_KEY` becomes a durable secret. Changing it makes every enrolled secret unreadable (a deliberate property); affected users must re-enrol.

## D-031: Invite-only registration and the invite-token lifecycle

**Date:** 2026-11-15
**Status:** Implemented — realises D-027 and Q2

There is **no public registration endpoint**. An administrator mints an invite; the invitee redeems it at `/register?token=…`.

- Token is 32 random bytes, stored only as SHA-256. Raw value returned once.
- Single use: the claim is atomic, and a second redemption is indistinguishable from an unknown token.
- 72-hour expiry.
- The role (`user` | `admin`) comes from the invite row, never from the request body.
- An email-bound invite rejects a different email, but the rejection happens only for the link holder and the message is deliberately not an enumeration oracle.
- Unknown, used and expired tokens share one generic message and one generic status.

**Why:** an open signup form on a self-hosted personal instance is a spam and resource-exhaustion surface, and account enumeration is a gift to credential stuffing. Invite-only keeps onboarding deliberate while still satisfying "allow a user to register".

**Consequences:** adding a person is an admin action. There is no `ALLOW_OPEN_REGISTRATION` flag to turn on accidentally; adding one later would be a new decision.

## D-032: Password reset without SMTP

**Date:** 2026-11-15
**Status:** Implemented — realises D-005 and Q3

There is no mail stack and no self-service "forgot password" email. An administrator issues a reset code from Settings → Users and hands it over out of band.

- Code is 32 random bytes, stored only as SHA-256, valid for **60 minutes**, usable **once**.
- Issuing a new code deletes the account's previous one, so a code already handed over stops working when a replacement exists.
- Redemption writes the password, clears `must_set_password`, revokes **every** session for the account, and deletes any sibling code — all in one transaction with the single-use claim.
- Unknown, expired and used codes share one generic failure.
- The public `/reset` page accepts `?code=…` or a typed code and is also the `must_set_password` path for newly created and migrated accounts.

**Why:** SMTP means credentials, deliverability, a new outbound dependency and a new phishing surface. For 2–10 users, an admin-mediated code is simpler and keeps the failure mode human.

**Consequences:** a non-admin who forgets their password waits for an admin. If email is wanted later, it is a separate decision with its own threat model.

## D-033: Fresh-install first-administrator bootstrap

**Date:** 2026-11-15
**Status:** Implemented — refines Q18

Q18 says production must fail to boot when `ADMIN_EMAIL` is missing or matches no user. That is right for a **migrated** database, where a non-match is an operator typo. It cannot hold literally for a **brand-new** database: there is no account for any email to match, so a fresh local deployment would be unbootable.

The rule is therefore:

- `ADMIN_EMAIL` missing → still fatal in production.
- Populated database, no match → still fatal (Q18's intent).
- **Empty `users` table** → create the first administrator with an unusable password and `must_set_password`, issue a single-use 60-minute reset code, and print it **once** at boot. The operator sets the password at `/reset`.

No password is generated or logged. The reset code is a credential with a one-use, 60-minute life, and it is the only way in, so it is printed loudly and once.

**Why not a CLI seed script:** a boot-time bootstrap is one code path, one place to document, and works for the exact `docker compose up` flow in the deployment guide. A CLI adds a second entry point that can drift.

**Consequences:** a fresh install's container logs contain one credential until it is used or expires. `SECURITY.md` records that residual and recommends setting the password promptly. A populated database keeps the fail-fast behaviour, so a typo cannot silently create a second administrator.
