# Time Keeper — Real Accounts, Local Auth, MFA and Admin

**Status:** accepted — committed design of record for Phases A–G.
**Baseline:** `main` at `1bbe486` (audit remediation Phases 0–3 landed).
**Decisions:** §2b is binding. It was confirmed by the operator on 2026-11-14 and settles every open item in §2. Do not re-open it, and do not ask questions it already answers.

Phase workers read this document from the repository. Do not copy it elsewhere; keep it here so every later phase references one canonical version.

---

## §1 What is actually being asked

Today the app has *delegated* authentication and *implicit* accounts:

- Identity arrives as an email header from Authentik via NPM.
- There is no `users` table; the email string is the primary key on every table.
- Accounts appear lazily on first write. No registration, no password, no roles, no lifecycle.

The request is to own identity instead:

1. provide real users (a `users` table with lifecycle),
2. username + password + MFA logon screen,
3. self-service registration, password change, profile update, account removal,
4. an admin role with a settings-page surface to add and remove users.

**Honest sizing:** this is roughly the size of the existing backend again — schema, auth core, sessions, crypto, MFA, ~8 API surfaces, ~6 screens, and the security review that goes with all of it. It is not a refactor of the header path; it is a new subsystem that replaces it. Split across the phases in §7, it is 7 PRs.

**The tradeoff worth stating plainly:** Authentik already does password policy, MFA, lockout, reset-by-email and session hygiene, and it has been audited by people who do only that. Building local auth means owning all of those failure modes permanently. The justification for doing it is autonomy and a single deployable artifact — not security. If that justification is thin, the cheaper path is to keep Authentik and just add the missing lifecycle UI (see §10, Option B).

---

## §2 Decisions register

**ALL DECISIONS BELOW ARE RESOLVED — see §2b. The defaults are now binding and were confirmed by the human on 2026-11-14. Do not re-open them.**

Each has a default so work never stalls. Override any of them before Phase A starts.

### D1 — Coexist with Authentik, or replace it?
**Default: coexist.** A new `AUTH_MODE` env (`local` | `proxy` | `hybrid`, default `hybrid` for one release, then `local`) keeps the existing header path working behind `isTrustedProxyPeer` + `INTERNAL_PROXY_SECRET`, so the current homeserver deployment does not break on upgrade. The homeserver then switches to `local` and the Authentik/NPM forward-auth config becomes optional.
**Why hybrid by default:** a cutover that removes proxy auth would lock every existing user out the moment it deploys, and the email-keyed data migration has to be provable on a real database first.

### D2 — Who can register?
**Default: admin-created + invite, with open registration off.**
- `users.invited_by`, single-use invite token (hashed, 72h expiry).
- `ALLOW_OPEN_REGISTRATION=false` in env; when true, `/api/auth/register` is public and creates role `user`.
**Why:** an open signup form on a self-hosted personal instance is a spam and resource-exhaustion surface. The asked-for "allow a user to register" is satisfied by the invite flow plus the toggle.

### D3 — MFA scope and mechanism
**Default: TOTP (RFC 6238) + 10 single-use recovery codes. Required for admins, optional-but-prompted for users.**
- Enrolment: secret generated server-side, shown once as `otpauth://` URI + QR; confirmed by a valid code before it is activated.
- Verification window ±1 step (30s); replay protection by storing the last accepted step per user.
- Recovery codes: 10 × 10 chars, Argon2id/scrypt-hashed, shown once, each deletable on use.
- TOTP secrets encrypted at rest with AES-256-GCM using `MFA_ENCRYPTION_KEY` (32-byte, from env), never stored plaintext.
**Why TOTP not WebAuthn:** TOTP works with every phone and needs no browser ceremony. WebAuthn is a later addition (§10), not a v1 requirement.

### D4 — Session transport
**Default: server-side sessions + `httpOnly` cookie + CSRF double-submit.**
- `sessions` table: `id` (opaque 32-byte random, only its SHA-256 stored), `user_id`, `created_at`, `last_seen_at`, `expires_at`, `user_agent`, `ip`.
- Cookie: `tk_session`, `HttpOnly`, `Secure` (always in production), `SameSite=Lax`, `Path=/`.
- Idle timeout 14 days, absolute 90 days, rotated on privilege change and on MFA completion.
- CSRF: a non-`httpOnly` `tk_csrf` cookie plus `X-CSRF-Token` header, compared in constant time, required on every non-GET `/api` route.
**Why not localStorage bearer tokens:** XSS turns them into account takeover. The cookie + CSRF pattern is boring and well understood. **This reintroduces a CSRF surface that does not exist today** — it must be in the threat model, not hand-waved.

### D5 — Password reset without email
**Default: no SMTP in v1.** Admin issues a single-use, 60-minute reset code from the user-management screen and hands it over out of band. Forgotten passwords for non-admins become an admin task.
**Why:** the repo has no mail stack, and adding SMTP means credentials, deliverability and a new outbound dependency. If email is wanted, that is a separate decision with its own plan.

### D6 — Account deletion
**Default: hard delete with cascade**, requiring password re-entry and, for admins, MFA. Guards: a user cannot delete the last admin; an admin cannot delete themselves while they are the last admin; deletion requires typing the username to confirm in the UI.
**Why hard delete:** "remove the account" was asked for explicitly; soft-delete leaves personal time data in the database after the user believes it is gone, which is a worse answer for a privacy-conscious request.

### D7 — How existing email-keyed data migrates
**Default: introduce `users.id` (UUID) and migrate the five `user_id` columns to it**, backfilling from distinct existing email values, creating one `users` row per distinct email with a random unusable password hash and a `must_set_password` flag.
**Why not keep email as the key:** the request includes "update basic info", and if email is the key, changing it means rewriting every row on every table. Doing the migration once, now, is far cheaper than doing it later under load. This is the single riskiest task in the plan (§9).

---

## §2b Resolved decisions (confirmed 2026-11-14 — binding)

Target scale: **2–10 users.** No bulk operations, no cross-user session administration, no surveillance features.

| # | Decision | Resolution |
|---|---|---|
| D1 | Authentik coexistence | **Hybrid**: `AUTH_MODE=local\|proxy\|hybrid`, default `local` at Phase F, proxy path preserved and tested |
| D2 | Registration | **Invite-only only.** No public `/api/auth/register` endpoint is built at all; no `ALLOW_OPEN_REGISTRATION` flag. Admin creates a user or issues a single-use 72h invite link |
| D3 | MFA | **TOTP + 10 recovery codes.** Required for admins, optional-but-prompted for users |
| D4 | Sessions | Server-side sessions, `httpOnly`+`Secure`+`SameSite=Lax` cookie, CSRF double-submit; **14-day idle / 90-day absolute**; signed-in-devices list with "sign out other devices" |
| D5 | Password reset | **No SMTP.** Admin issues a 60-minute single-use reset code, handed over out of band |
| D6 | Account deletion | **Self-delete: hard cascade.** **Admin-delete: admin chooses cascade or reassign-entries-to-themselves** at delete time. Guards: cannot remove the last admin; cannot self-delete as last admin; typed confirmation |
| D7 | Data keying | Introducing `users.id` (UUID), backfill from distinct existing emails |
| Q2 | First admin | `ADMIN_EMAIL` env; matching migrated user promoted to `role='admin'` in the migration |
| Q3 | Migrated users' passwords | `must_set_password=true`; admin issues reset code afterwards. No passwords generated or logged |
| Q5 | Login identifier | **Username or email**, either accepted |
| Q7 | Session lifetimes | 14-day idle, 90-day absolute |
| Q11 | Admin UI scope | **Minimal + disable/enable + audit-log viewer.** No bulk invite, no force-MFA-reset, no cross-user session kill |
| Q12 | Audit log | **Yes** — `auth_events` written, admin-only viewer, **90-day retention** (prune job) |
| Q14 | Usernames | 3–32 chars, `[a-z0-9_-]`, lowercase-normalised, **immutable**, reserved names blocked (`admin`, `api`, `me`, `root`, `system`) |
| Q15 | Email | **Mandatory and unique** for every user; login alias only (no verification — no SMTP) |
| Q16 | Admin-deleted user data | Admin picks cascade **or** reassign entries |
| Q17 | Sensitive-action freshness | **5 minutes** since password+MFA; then re-auth prompt. Applies to: password change, token minting, role change, account deletion, MFA disable |
| Q18 | Bootstrap failure | Production **fails to boot** if `ADMIN_EMAIL` is missing or matches no user. Dev warns and continues with no admin |
| Q19 | Build autonomy | **Full**: worker builds, native reviewer runs per PR, worker addresses comments, self-merges when all four checks are green |
| Q20 | Design location | Committed at `docs/design/auth-accounts.md` + ADR entries in `docs/memory/decisions.md` |
| Q21 | Local dev | `DEV_USER_ID` bypass only for `AUTH_MODE=proxy`. In `local` mode, seed a dev admin (`admin@localhost`) with password from `DEV_ADMIN_PASSWORD`, printed once at boot. **Real login is the local dev path** |
| Q22 | Password policy | 12 chars minimum, reject username/email substrings, **local** common-password denylist, **no outbound breach-check calls** |
| Q23 | Auth rate limits | 10 attempts/min per IP; per-account backoff 5 failures → 1 min doubling to 15 min cap, cleared on success; counters persisted in DB |
| Q24 | Legacy `monthly_project_goals` | Leave in place; out of the migration except where the FK is trivially correct |
| Q25 | Existing API tokens | **Remapped to `users.id`** in the migration so the macOS app keeps working |
| Q26 | Phase F docs | README setup, `auth.md` rewritten, screenshots regenerated |
| Q27 | Auth page styling | Match the existing macOS-native shadcn design system exactly |

---

## §3 Security model

| Concern | Approach |
|---|---|
| Password storage | `crypto.scrypt` (stdlib, no new dependency), N=2^15, r=8, p=1, 16-byte salt, 64-byte output; versioned prefix so params can be raised later without breaking old hashes |
| Comparison | `crypto.timingSafeEqual` everywhere, including CSRF and token checks |
| Login enumeration | Identical response and timing for unknown-user vs wrong-password (`scrypt` against a dummy hash), single generic message |
| Lockout | Per-account + per-IP counters, exponential backoff (5 failures → 1 min, doubling, cap 15 min), cleared on success; counters in the DB so they survive restarts |
| Session fixation | New session ID on login, on MFA completion, and on password change |
| Password policy | ≥12 chars, checked against a small common-password denylist; reject username/email substrings; no composition rules (they produce `Password1!`) |
| Rate limiting | Reuse the existing limiter; `/api/auth/*` gets its own stricter bucket, keyed per account as well as per IP |
| Audit log | `auth_events` table: login success/failure, MFA enrol/disable, password change, role change, user create/delete, reset issued. Admin-visible, not user-editable |
| Secret handling | `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `INVITE_TOKEN_PEPPER` from env; startup fails loudly if missing in production |
| Timing | Constant-time on all comparisons; no early return that leaks user existence |

Threat-model additions required in `SECURITY.md`: credential stuffing, session theft, CSRF, TOTP phishing/replay, privilege escalation via the admin API, and the invite-token lifecycle.

---

## §4 Data model

```sql
-- new
users(id PK, email UNIQUE NOT NULL, username UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, password_updated_at, role TEXT NOT NULL DEFAULT 'user',
      display_name, mfa_enabled INTEGER NOT NULL DEFAULT 0, mfa_secret_enc TEXT,
      mfa_last_step INTEGER, must_set_password INTEGER NOT NULL DEFAULT 0,
      invited_by, created_at, last_login_at)
sessions(id_hash PK, user_id FK, created_at, last_seen_at, expires_at, absolute_expires_at, user_agent, ip)
recovery_codes(id PK, user_id FK, code_hash, used_at)
invites(id PK, token_hash, email, role, created_by, expires_at, used_at)
auth_events(id PK, user_id, kind, ip, user_agent, meta_json, created_at)

-- changed: user_id columns on categories, time_entries, user_settings, api_tokens,
--          monthly_project_goals become FKs to users.id (D7). Indexes and the
--          partial unique index on time_entries are preserved as-is.
```

`user_settings` keeps `user_id` as its primary key, now referencing `users.id`. Its `timezone` column is unaffected.

Note: `users.email` UNIQUE means the proxy path can resolve an email to a user deterministically, which is what makes D1's hybrid mode possible.

---

## §5 API surface

Public (no session): `POST /api/auth/login`, `POST /api/auth/login/mfa`, `POST /api/auth/register` (only if open registration), `POST /api/auth/accept-invite`, `GET /api/auth/status`.

Session-scoped: `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/me`, `PATCH /api/auth/me` (display name, username, email), `POST /api/auth/password`, `POST /api/auth/mfa/enrol`, `POST /api/auth/mfa/confirm`, `POST /api/auth/mfa/disable`, `POST /api/auth/mfa/recovery-codes/regenerate`, `DELETE /api/auth/me`.

Admin-only (`role='admin'`): `GET /api/admin/users`, `POST /api/admin/users` (create), `PATCH /api/admin/users/:id` (role, disabled), `DELETE /api/admin/users/:id`, `POST /api/admin/users/:id/reset` (issues reset code), `POST /api/admin/invites`, `GET /api/admin/auth-events`.

Two guards worth building once and reusing: `requireAuth` (session or, in hybrid mode, the existing header/token paths) and `requireAdmin`, which returns 404 rather than 403 for non-admins so the admin surface is not discoverable.

`me` responses must never include `password_hash`, `mfa_secret_enc`, or recovery codes — a serialiser, not ad-hoc object spreading.

---

## §6 Frontend surface

- `pages/Login.tsx` — username/email + password, then a second step for TOTP; both with the same generic error copy.
- `pages/Register.tsx` — invite acceptance, or open registration when enabled; shows the password policy inline.
- `pages/Account.tsx` — profile (display name, username, email), password change (current + new), MFA enrol/disable with QR and recovery codes, session list with "sign out other devices", delete account with confirmation.
- `pages/admin/Users.tsx` — table of users, create/invite, role toggle, reset code, delete. Rendered in Settings behind `role === 'admin'`.
- `components/AuthGate.tsx` — wraps the app; `401` from any query redirects to login preserving the intended route. This replaces the existing `SessionExpiredOverlay` behaviour.
- `lib/authContext.ts` grows from a stub into session state: current user, role, MFA status, and a `refresh()` used after privilege changes.
- `lib/api.ts`: attach `X-CSRF-Token`, handle `401` and `403` distinctly, and stop assuming the identity is an email header.

Conventions: match the existing shadcn/ui + Tailwind patterns, reuse `QueryState` for loading/error/retry, keep the macOS-native visual language Phase 3 established. No new UI framework.

---

## §7 Phases

Each phase is one PR and ends with a green gate. **Phase A is the only one that can break the running app**, so it carries the most verification.

### Phase A — Identity foundation (no UI change, proxy mode still authoritative)
| Task | Acceptance |
|---|---|
| A1 schema + D7 migration | `users`/`sessions`/`recovery_codes`/`invites`/`auth_events` created; five `user_id` columns backfilled from distinct emails; every pre-existing row still readable through the old code path; migration is idempotent and reversible enough to restore from backup |
| A2 password hashing module | scrypt with versioned prefix; round-trip tests; wrong password fails; timing-test proves no early exit |
| A3 session core | create/verify/rotate/revoke; cookie flags asserted in tests; expiry honoured; revoked session rejected immediately |
| A4 `requireAuth` / `requireAdmin` | unit tests; existing header/token paths still pass the existing 100+ backend tests unchanged |
| A5 startup config validation | production refuses to boot without `SESSION_SECRET`/`MFA_ENCRYPTION_KEY`; dev generates ephemeral ones with a loud warning |

**Gate A:** full suite green on host Node 26 and `node:22-bookworm-slim`; a seeded copy of a real database migrates and every entry is still attributable to the right user; `/api/info` unchanged for header-auth requests.

### Phase B — Local login (the switch is now possible)
- `POST /api/auth/login` (+ MFA step), session cookie issuance, CSRF middleware, lockout counters.
- `AuthGate` + `Login.tsx`; `AUTH_MODE=local` becomes usable end to end.
- Tests: login success/failure/enumeration, lockout backoff, CSRF rejection on mutation without token, cookie flags, session fixation rotation.

**Gate B:** with `AUTH_MODE=local` and no Authentik in the path, a user can log in, use every existing screen, and log out. With `AUTH_MODE=hybrid`, the old header path still works.

### Phase C — Self-service lifecycle
- Registration via invite (`ALLOW_OPEN_REGISTRATION` honoured), accept-invite, password change, profile update with uniqueness conflict handling, delete account with cascade + guards, logout-all.
- `Register.tsx`, `Account.tsx` profile/password/delete sections.
- Tests: invite single-use and expiry, password change invalidates other sessions, delete cascades every user-scoped table, last-admin guards, email/username uniqueness races (unique constraint → 409, not 500).

**Gate C:** a full lifecycle works on a scratch database: invite → register → use app → change password → change email → delete account, with zero orphan rows.

### Phase D — MFA
- TOTP enrol/confirm/verify, recovery codes, encrypted secret storage, replay protection, `auth_events` entries.
- `Account.tsx` MFA section with QR + recovery-code display; login second step.
- Tests: RFC 6238 vectors, ±1 window, reuse of the same code rejected, wrong code does not lock the account, recovery code single-use, disabling MFA requires password.

**Gate D:** admin accounts cannot reach admin routes without MFA once enrolled; recovery-code path restores access after a wiped authenticator.

### Phase E — Admin
- `requireAdmin`, user management API, invite issuance, reset codes, `auth_events` viewer.
- `pages/admin/Users.tsx` mounted in Settings for admins only.
- Tests: non-admin gets 404 on every admin route; cannot delete last admin; cannot demote self as last admin; disabled user cannot log in; role change requires MFA.

**Gate E:** first-user bootstrap creates exactly one admin; a second admin can be created and can delete the first.

### Phase F — Cutover, docs, invariants
- Switch the homeserver to `AUTH_MODE=local`; document the rollback to `proxy`.
- **Rewrite `docs/memory/invariants.md`**: I-001 "Authentik owns auth" and the "no users table" rule are reversed. New invariants: password hashes never leave the DB; sessions are server-side and revocable; MFA secrets are encrypted at rest; admin routes 404 for non-admins.
- `SECURITY.md`: new threat-model rows (§3), dependency table rows for any new package, audit date.
- `docs/integration/auth.md` rewritten; `README.md` setup section updated; screenshots regenerated for the login and account pages.
- ADR entries for D1–D7.

**Gate F:** `SECURITY.md` describes the code as it is; a reviewer can trace every auth route to a test.

### Phase G — Hardening (separate, can be deferred)
Audit-log retention, optional WebAuthn, optional SMTP password reset, per-user session device management, CSP tightening for the login page, penetration-test checklist.

---

## §8 Invariant and governance impact

This plan **deliberately breaks** two documented invariants. Both must be rewritten in the same PR that changes the behaviour, not afterwards:

1. **"Authentik owns auth"** → becomes "the app owns local auth; proxy auth is an optional mode".
2. **"No users table"** → becomes "`users` is the identity record; every data table FKs to `users.id`".

It also touches `.pi-rules` assumptions about the deployment being single-artifact behind NPM. The homeserver deploy becomes self-contained for auth, which is the point, but it means the security posture of the app is no longer inherited from Authentik.

Because this changes auth, payments-adjacent nothing, but **auth + data access decisively**: per the repo's own governance rule, it needs human review before merge, not just green CI. I would also run a dedicated security review (not the same reviewer that writes it) on Phase A and Phase D specifically.

---

## §9 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| D7 migration corrupts user attribution | Low | Critical | Take a WAL-safe backup first (the drill from P2-8 exists), migrate a copy, diff row counts and per-user totals before and after, keep the backup until a week of real use |
| Hand-rolled crypto subtlety (TOTP window, timing, GCM nonce reuse) | Medium | High | Stdlib only, RFC test vectors, constant-time comparison helper used everywhere, independent review on Phases A and D |
| CSRF gap after adding cookies | Medium | High | Double-submit implemented centrally in middleware, tested on every mutating route, not per-route |
| Lockout used as a DoS against a known username | Medium | Medium | Backoff keyed on account *and* IP, with an admin unlock action; never permanent lock |
| Admin surface leaking existence | Low | Medium | 404 for non-admins, no user enumeration in any public response |
| Scope creep into email/SMTP/WebAuthn | High | Medium | Explicitly out of scope (§10) until Phase G |
| Two auth modes drift apart | Medium | Medium | Shared `requireAuth` contract; the full existing suite must pass in both modes at every phase gate |

---

## §10 Explicitly out of scope for v1

- SMTP, self-service "forgot password" email, email verification.
- WebAuthn/passkeys, SSO/SAML/OIDC *into* this app.
- Multi-tenancy, organisations, per-user sharing of categories or entries.
- Per-user data export/import (worth adding soon after, as a privacy counterpart to hard delete).
- **Option B, for the record:** if the real goal is only user lifecycle (add/remove people, see who exists), keeping Authentik and adding an admin page that manages Authentik users via its API would be a fraction of this work and zero new crypto. D1's default keeps this path open, so choosing Option B later does not waste Phase A.

---

## §11 Definition of done

1. `AUTH_MODE=local` runs the entire app with no Authentik in the path; `AUTH_MODE=proxy` still works.
2. A user can be invited, register, log in with password + TOTP, change password, change profile, and delete their account, with no orphan rows.
3. An admin can add, disable, reset and remove users, and every admin route 404s for non-admins.
4. All suites green on host Node 26 and `node:22-bookworm-slim`; audit and trivy clean; four CI checks green.
5. `invariants.md`, `SECURITY.md`, `auth.md`, `README.md` and the ADR log all describe the new reality.
6. An independent reviewer has read Phases A and D and their comments are resolved.
