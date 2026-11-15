# Invariants — Time Keeper

These rules must never be broken. Before making architectural changes, verify they still hold.

---

## I-001: The app owns local authentication; proxy auth is an optional mode

The application is the source of truth for identity. Accounts, passwords, sessions, MFA and the
lifecycle around them live in this codebase and in its SQLite database:

- `AUTH_MODE=local` (the default) authenticates with the app's own login endpoint and a
  server-side session cookie.
- `AUTH_MODE=proxy` keeps the pre-accounts deployment working: the backend reads the
  `X-authentik-email` header that Authentik's proxy outpost sets, but only from a trusted proxy
  peer and only with the matching `X-Internal-Token` in production.
- `AUTH_MODE=hybrid` accepts both during a staged migration.

This reverses the original I-001 ("Auth is Authentik's responsibility"). Authentik is still a
supported and fully tested path, but it is **not** the owner of the app's accounts and it is not
required to deploy. The backend still never imports a JWT/OIDC library and never contacts an
identity provider directly.

The decision and its consequences are recorded in ADR D-023; the binding design is
`docs/design/auth-accounts.md` §2b.

## I-002: Missing credentials = 401 in production

A request with no valid credential is rejected with 401. There is no fallback user in production
and no "trusted network" shortcut.

- A session cookie is accepted only when it names a live, unexpired `sessions` row.
- The Authentik header path is accepted only when `AUTH_MODE` allows it, the TCP peer is
  loopback/private or inside `TRUSTED_PROXY_CIDRS`, and (in production) the request carries a
  matching `X-Internal-Token`.
- The `DEV_USER_ID` fallback exists only when `NODE_ENV !== 'production'` **and**
  `AUTH_MODE=proxy`. In the default local mode, development uses the real login flow.

Enforced in `packages/backend/src/middleware/auth.ts`.

## I-003: One active timer per user

At any given moment, a user can have at most one running timer (a `time_entries` row with `end_time IS NULL`). This is enforced in two places:

- `timerService.startTimer()` auto-stops any running timer before creating a new one.
- The database has a partial unique index `idx_entries_one_open_per_user ON time_entries (user_id) WHERE end_time IS NULL` (migration `0009`), so no code path can insert a second open row. `PATCH /api/entries/:id` rejects `endTime: null`.

## I-004: All times stored in UTC ISO 8601

`start_time` and `end_time` in the `time_entries` table are stored as UTC ISO 8601 strings (e.g. `"2026-02-18T09:30:00.000Z"`). Never store local time. The frontend converts to local time for display only.

Bucketing into days uses the user's IANA `user_settings.timezone` (ADR D-019); storage stays UTC.

## I-005: The DB file is the only stateful resource

The entire application state lives in a single SQLite file at `DATABASE_PATH` (default `/data/time-keeper.db` in production). Backups = copying this file. There is no cache, no external session store, and no other persistence.

This now includes the auth subsystem: `users`, `sessions`, `recovery_codes`, `invites`,
`password_reset_codes` and `auth_events` are rows in the same file. A WAL-safe snapshot is
therefore a complete backup of accounts, sessions and MFA state as well as time data.

## I-006: Rounding never adds beyond weekly headroom, and never discards raw minutes

`computeRounding()` in `packages/shared/src/utils/rounding.ts` follows these rules:

- Rounding may add a **bonus** only up to the remaining weekly headroom.
- It **never reduces a category below its raw minutes** — the bonus can be removed, real work cannot.
- If the day's raw minutes alone exceed the remaining headroom, the bonus is zero and the result reports `weekWouldExceed: true`. The API surfaces that overrun instead of clamping real work.

The cap is the user's configured weekly goal (stored in `user_settings.weekly_goal_hours`, default 40 h = 2400 min). The service layer reads this from the DB and passes it to `computeRounding()`; do not bypass it or hardcode 2400.

The rounding increment (30 or 60 min, stored in `user_settings.rounding_increment_minutes`, default 60) is also read from the DB and passed to `computeRounding()` as its fourth argument. Do not hardcode 60.

## I-007: nginx forwards identity headers only for the proxy path, and no auth port is published

In `AUTH_MODE=proxy` (or `hybrid`), `packages/frontend/nginx.conf` must pass the identity headers
from Authentik's embedded outpost through to the backend:

```nginx
proxy_set_header X-authentik-email $http_x_authentik_email;
proxy_set_header X-authentik-username $http_x_authentik_username;
proxy_set_header X-authentik-uid $http_x_authentik_uid;
```

Never remove these lines: they keep the optional proxy mode working. In `local` mode they are
inert because the backend ignores the header.

Independent of mode, **neither container publishes a host port.** NPM reaches `frontend:80` and
`backend:3001` over the external `proxy-net` network. In proxy mode, publishing `:80` would let
anyone who can reach it mint an identity by sending `X-authentik-email`. In local mode the same
rule holds: the login endpoint is not an excuse to expose the backend directly.

## I-008: `users` is the identity record; every data table FKs to `users.id`

The app has a `users` table (migration `0011`). Identity is a UUID primary key, not the Authentik
email string:

- `categories`, `time_entries`, `user_settings` and `api_tokens` carry `user_id` as a foreign key
  to `users.id` (`ON DELETE CASCADE`). `monthly_project_goals` remains as a legacy table (Q24).
- Every query is scoped to `req.userId`, which is `users.id` and never the email.
- The proxy path resolves the header email to a `users` row with `ensureProxyUser()`; an unseen
  email is provisioned on first sight with an unusable password and `must_set_password`.
- Deleting an account is a schema-level operation: self-delete cascades, admin-delete chooses
  cascade or reassign (D-028).

This reverses the original I-008 ("No users table / Authentik owns user management"). Do not
reintroduce email-keyed data.

## I-009: Token management requires interactive authentication

`GET /api/tokens`, `POST /api/tokens`, and `DELETE /api/tokens/:id` must never accept a Bearer
token. A Bearer token receives `403 Forbidden`:

- `authMethod === 'token'` → 403.
- `authMethod === 'header'` (proxy mode) → allowed; Authentik authenticates every hop.
- `authMethod === 'session'` → allowed only when the session was established within the last five
  minutes (Q17), otherwise 403 `reauthentication_required`.

**Why:** prevents a compromised Bearer token from creating additional tokens (privilege
escalation), listing existing tokens (information disclosure), or locking out the user by revoking
all tokens. Enforced by `requireTokenManagementAuth` in `packages/backend/src/middleware/auth.ts`.

## I-010: Password hashes never leave the database

- Passwords are stored only as `crypto.scrypt` hashes with a versioned prefix
  (`scrypt$v1$N$r$p$salt$hash`) in `users.password_hash`.
- A migrated or admin-created account that has not set a password carries an `unusable$…` sentinel
  that no input can verify against.
- `password_hash`, `mfa_secret_enc` and recovery codes are **never** returned by any route, log
  line or error. Responses use explicit serialisers (`serializeUser`, `serializeAdminUser`), never
  object spreading.
- Passwords are never logged, generated-and-logged, or sent anywhere. Comparisons use
  `crypto.timingSafeEqual` (constant-time), and the unknown-user path hashes against a dummy value
  so it costs the same as a wrong password.

## I-011: Sessions are server-side and revocable

- A session is a row in `sessions`; the browser holds an opaque 32-byte id in the `tk_session`
  cookie. The database stores only the SHA-256 of that id, so a database leak does not hand over
  live sessions.
- Cookie flags: `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`.
- Idle timeout is 14 days and the absolute cap is 90 days (Q7). `last_seen_at` slides the idle
  deadline; `absolute_expires_at` never moves.
- A session id is rotated on login, on MFA completion, and on password change (fixation defence).
- Revocation is immediate: a deleted session row is rejected on the next request. "Sign out other
  devices" and admin-disable both work by deleting rows.
- CSRF uses double-submit: a non-`httpOnly` `tk_csrf` cookie plus `X-CSRF-Token`, compared in
  constant time and required on every non-GET `/api` route.

## I-012: MFA secrets are encrypted at rest

TOTP secrets are stored only as AES-256-GCM ciphertext in `users.mfa_secret_enc`, with a unique IV
per record and a verified auth tag. The key comes from `MFA_ENCRYPTION_KEY` (32 bytes), is never
stored beside the ciphertext, and production refuses to boot without it.

- Changing `MFA_ENCRYPTION_KEY` makes every enrolled secret unreadable. That is a deliberate
  property, not a bug: back the key up with the database and treat rotation as a re-enrolment
  event.
- Enrolment is confirm-before-activate; the pending secret is not active until a code verifies.
- Replay protection: `users.mfa_last_step` stores the last accepted TOTP step.
- Recovery codes are stored only as hashes and are single-use.
- No route returns `mfa_secret_enc` or recovery-code hashes.

## I-013: Admin routes return 404 for non-admins

`requireAdmin` answers **404 Not Found** — not 403 — for an account whose `role !== 'admin'`, so
the admin surface is not discoverable. This applies to every `/api/admin/*` route and to the
Settings entry point, which is not rendered for non-admins.

The one deliberate exception is a legitimate **local** administrator who has not enrolled MFA
yet: that request gets 403 with `code: 'mfa_enrolment_required'`, because the correct answer is
"go and enrol", not "this page does not exist". The 404 still hides the surface from everyone
else.

## I-014: Sensitive actions require a fresh (5-minute) credential check

Q17 names the actions: password change, API-token minting, role change, account deletion, MFA
disable and recovery-code regeneration. Each requires a credential check within the last **five
minutes**:

- `session` older than five minutes → 403 `reauthentication_required`; the UI prompts a fresh
  sign-in.
- `header` (proxy mode) is allowed: Authentik re-authenticates every hop, so there is no
  long-lived session to go stale.
- `token` (Bearer) is refused with 403: a machine credential must never perform an
  account-lifecycle action.

## I-015: One-time credentials are stored only as hashes

Invite tokens, password-reset codes, MFA recovery codes, session ids and API tokens are all
high-entropy values that the database stores only as a hash (SHA-256 for random tokens and reset
codes; a password KDF for recovery codes). Consequences that must hold:

- Raw values are returned to the holder exactly once and never logged or re-readable.
- Invite tokens are single-use with a 72-hour expiry. Reset codes are single-use with a 60-minute
  expiry; issuing a new code deletes the previous one.
- Unknown, expired and already-used values produce the **same** generic failure, so a stale value
  cannot be probed for whether its account still exists.
- Redeeming a reset code revokes every session for the account and clears `must_set_password` in
  the same transaction.
