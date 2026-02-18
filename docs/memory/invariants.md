# Invariants — Time Keeper

These rules must never be broken. Before making architectural changes, verify they still hold.

---

## I-001: Auth is oauth2-proxy's responsibility

The backend **never** validates JWT tokens, never imports a JWT library, and never contacts Authentik directly. oauth2-proxy handles all OIDC flows.

The backend only reads the `X-Auth-Request-User` header that oauth2-proxy sets.

## I-002: Missing auth header = 401 in production

If `X-Auth-Request-User` is absent and `NODE_ENV=production`, the auth middleware **must** return 401. There is no fallback user in production. This is enforced in `packages/backend/src/middleware/auth.ts`.

The `DEV_USER_ID` fallback is only active when `NODE_ENV !== 'production'`.

## I-003: One active timer per user

At any given moment, a user can have at most one running timer (a `time_entries` row with `end_time IS NULL`). The `timerService.startTimer()` function auto-stops any running timer before creating a new one.

## I-004: All times stored in UTC ISO 8601

`start_time` and `end_time` in the `time_entries` table are stored as UTC ISO 8601 strings (e.g. `"2026-02-18T09:30:00.000Z"`). Never store local time. The frontend converts to local time for display only.

## I-005: The DB file is the only stateful resource

The entire application state lives in a single SQLite file at `DATABASE_PATH` (default `/data/time-keeper.db` in production). Backups = copying this file. There is no cache, no session store, no other persistence.

## I-006: Rounding never exceeds 40h per week

The `computeRounding()` function in `packages/shared/src/utils/rounding.ts` must never produce a result where `weekMinutesSoFar + dayRoundedTotal > 2400`. The cap logic is there to enforce this. Do not bypass it.

## I-007: nginx must forward the auth header

In production, the nginx container sits between oauth2-proxy and the backend. nginx must pass the auth header through:

```nginx
proxy_set_header X-Auth-Request-User $http_x_auth_request_user;
```

This is in `packages/frontend/nginx.conf`. Never remove this line.

## I-008: No users table

Authentik owns user management. The app has no `users` table. User identity is a plain text `user_id` column in `categories` and `time_entries`. Deactivating a user in Authentik is sufficient to lock them out (oauth2-proxy blocks them before the app sees the request).
