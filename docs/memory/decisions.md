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

## D-004: user_id denormalized into all tables

**Date:** 2026-02
**Status:** Accepted

Every row in `categories` and `time_entries` has a `user_id TEXT` column. There is no `users` table. This is intentional:
- Authentik owns user creation/deletion — the app doesn't need to know
- Queries are simple `WHERE user_id = ?` filters
- No JOIN needed to enforce data ownership
- If a user is removed from Authentik, their data stays in DB but is inaccessible

## D-005: Active timer = entry with null end_time

**Date:** 2026-02
**Status:** Accepted

A running timer is represented as a `time_entries` row where `end_time IS NULL`. There is no separate `timers` table or state field. Stopping a timer = setting `end_time`. The single-timer invariant (I-003) is enforced by the service layer, not the DB schema.

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
