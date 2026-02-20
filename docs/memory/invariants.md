# Invariants — Time Keeper

These rules must never be broken. Before making architectural changes, verify they still hold.

---

## I-001: Auth is Authentik's responsibility

The backend **never** validates JWT tokens, never imports a JWT library, and never contacts Authentik directly. Authentik's proxy outpost handles all auth flows and sets identity headers on authenticated requests.

The backend only reads the `X-authentik-email` header that the outpost sets.

## I-002: Missing auth header = 401 in production

If `X-authentik-email` is absent and `NODE_ENV=production`, the auth middleware **must** return 401. There is no fallback user in production. This is enforced in `packages/backend/src/middleware/auth.ts`.

The `DEV_USER_ID` fallback is only active when `NODE_ENV !== 'production'`.

## I-003: One active timer per user

At any given moment, a user can have at most one running timer (a `time_entries` row with `end_time IS NULL`). The `timerService.startTimer()` function auto-stops any running timer before creating a new one.

## I-004: All times stored in UTC ISO 8601

`start_time` and `end_time` in the `time_entries` table are stored as UTC ISO 8601 strings (e.g. `"2026-02-18T09:30:00.000Z"`). Never store local time. The frontend converts to local time for display only.

## I-005: The DB file is the only stateful resource

The entire application state lives in a single SQLite file at `DATABASE_PATH` (default `/data/time-keeper.db` in production). Backups = copying this file. There is no cache, no session store, no other persistence.

## I-006: Rounding never exceeds the user's weekly goal

The `computeRounding()` function in `packages/shared/src/utils/rounding.ts` must never produce a result where `weekMinutesSoFar + dayRoundedTotal > weeklyGoalMinutes`. The cap is the user's configured weekly goal (stored in `user_settings.weekly_goal_hours`, default 40 h = 2400 min). The service layer reads this from the DB and passes it to `computeRounding()`; do not bypass it or hardcode 2400.

## I-007: nginx must forward the auth headers

The frontend nginx container proxies `/api/*` to the backend. It must pass the identity headers from Authentik's embedded outpost through:

```nginx
proxy_set_header X-authentik-email $http_x_authentik_email;
proxy_set_header X-authentik-username $http_x_authentik_username;
proxy_set_header X-authentik-uid $http_x_authentik_uid;
```

This is in `packages/frontend/nginx.conf`. Never remove these lines.

Note: Authentik's embedded outpost uses `X-authentik-*` headers (lowercase, hyphenated).
This is set in the NPM proxy template and differs from the standalone outpost's `X-Forwarded-*` headers.

## I-008: No users table

Authentik owns user management. The app has no `users` table. User identity is a plain text `user_id` column in `categories`, `time_entries`, and `user_settings`. Deactivating a user in Authentik is sufficient to lock them out (the outpost blocks them before the app sees the request).
