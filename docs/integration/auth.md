# Auth Integration — Local Accounts (and optional Authentik proxy mode)

Time Keeper owns its authentication. Accounts, passwords, sessions, TOTP MFA, invites and reset
codes live in the app's own SQLite database.

`AUTH_MODE` selects how a browser is authenticated:

| Mode | Browser path | Needs Authentik / NPM forward auth |
|------|--------------|------------------------------------|
| `local` **(default)** | App login (`/login`, `POST /api/auth/login`) + `tk_session` cookie | No |
| `proxy` | Trusted `X-authentik-email` header from the forward-auth proxy | Yes |
| `hybrid` | Both, for a staged migration | Only for the header path |

The macOS app's Bearer-token path (`api.*` subdomain) works in every mode. See
[docs/integration/api-subdomain.md](api-subdomain.md).

The binding design and decisions are in `docs/design/auth-accounts.md`; the security posture is in
[SECURITY.md](../../SECURITY.md); the ADRs are D-022–D-033 in `docs/memory/decisions.md`.

---

## Architecture

### Default: local accounts

```
Browser
  └── NPM (TLS only; proxy-net)
        └── frontend nginx:80
              ├── static SPA (React)
              └── /api/* → backend:3001
                            ├── GET  /api/auth/status      (public)
                            ├── POST /api/auth/login       (public)
                            ├── POST /api/auth/login/mfa   (public)
                            ├── POST /api/auth/accept-invite (public)
                            ├── POST /api/auth/reset       (public)
                            └── everything else → requireAuth (session cookie)
```

No identity provider is in the path. The backend resolves the `tk_session` cookie to a `sessions`
row, and that row to a `users` row. Every data query is scoped to `users.id`.

### Optional: Authentik forward auth

```
Browser
  └── NPM (TLS + Authentik forward auth)
        └── Authentik embedded outpost (auth check)
        └── (authenticated) → frontend nginx:80
                                   └── /api/* → backend:3001
                                                   └── reads X-authentik-email
```

Only used when `AUTH_MODE=proxy` (or `hybrid`). The trust rules are in
[Proxy mode](#proxy-mode-optional) below. **Nothing is published to the host in either mode:** NPM
reaches `frontend:80` and `backend:3001` over the external `proxy-net` Docker network.

---

## Local accounts in detail

### Login

- `GET /api/auth/status` tells the SPA whether a session exists and which mode is active.
- `POST /api/auth/login` accepts `{ identifier, password }`, where `identifier` is a **username or
  an email** (Q5).
- A correct password for an MFA-enrolled account returns `200 { status: 'mfa_required' }` and sets
  **no** cookie. `POST /api/auth/login/mfa` re-sends the same credentials plus `code` (a 6-digit
  TOTP code or a recovery code) and completes the session.
- Every credential failure returns the same 401 body; lockout returns 429 with `Retry-After`.
- On success the response sets two cookies:
  - `tk_session` — `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`.
  - `tk_csrf` — deliberately readable by same-origin JS; its value must be echoed in the
    `X-CSRF-Token` header on every non-GET `/api` request.

### Sessions

Server-side rows in `sessions`, with only the SHA-256 of the id stored. Idle timeout 14 days;
absolute cap 90 days; id rotated on login, MFA completion and password change. The Account page
lists signed-in devices and can sign out one or all of the others.

### MFA

TOTP (RFC 6238), ±1 step, replay-protected, with ten single-use recovery codes. Admins are
required to enrol; users are prompted. Secrets are AES-256-GCM encrypted at rest.

- `POST /api/auth/mfa/enrol` → pending secret + `otpauth://` URI. Nothing is active yet.
- `POST /api/auth/mfa/confirm` → verifies a code and returns the recovery codes **once**.
- `POST /api/auth/mfa/disable` → password + a session fresher than five minutes.
- `POST /api/auth/mfa/recovery-codes/regenerate` → password + freshness.

### Invites (registration is invite-only)

There is no public registration form. An administrator creates the account directly or mints an
invite:

1. `POST /api/admin/invites` returns the raw token **once** and an `acceptPath` such as
   `/register?token=…`.
2. Hand the link over out of band (no SMTP).
3. The invitee opens it, chooses an email, username and password, and lands signed in.

Tokens are single-use, hashed at rest, and expire after 72 hours.

### Password reset / first password

There is no "forgot password" email. An administrator issues a reset code:

1. Settings → Users → **Reset password** (`POST /api/admin/users/:id/reset`), or create a user and
   receive the same code.
2. The code is shown once, valid for 60 minutes and usable once. Hand it over out of band.
3. The user opens `/reset?code=…` (or `/reset` and types the code), chooses a password of at least
   12 characters, and submits.

The same page is the `must_set_password` path. A newly created account, a migrated account, and the
first administrator on a fresh database all start with an unusable password and clear the flag by
redeeming a reset code here. Redemption revokes every existing session.

### Admin

Every `/api/admin/*` route returns **404** to a non-admin (the surface is not discoverable), and
403 `mfa_enrolment_required` to a session-authenticated admin without MFA. Role changes, user
deletion and reset-code issuance require a session fresher than five minutes. The last
administrator cannot be demoted, disabled or deleted.

---

## First administrator and cutover

### Migrated database (the homeserver case)

Phase A's migration creates one `users` row per distinct legacy email, promoted by `ADMIN_EMAIL`
at boot. Migrated accounts have no password (`must_set_password`). The cutover uses `hybrid` so the
proxy path keeps working while people set passwords:

1. **Back up the database** with the WAL-safe snapshot in
   [runbooks](../operations/runbooks.md#rb-006-wal-safe-backup), and rehearse the Phase A migration
   on a copy per [migration-phase-a.md](../operations/migration-phase-a.md).
2. Set the required secrets and `ADMIN_EMAIL`, and start with `AUTH_MODE=hybrid`. The existing NPM
   forward-auth host config stays in place.
3. Sign in through Authentik as the `ADMIN_EMAIL` account. Because the request is
   header-authenticated, admin routes work without local MFA at this stage.
4. In Settings → Users, issue a reset code for each account (including your own). If the account
   list is not visible yet, the migration or `ADMIN_EMAIL` is wrong — stop and fix it.
5. Each person opens `/reset?code=…` and sets a password. This clears `must_set_password`.
6. Still as the admin, open `/account` and enrol TOTP. Admin features require it once you are
   authenticated by a session.
7. Switch to `AUTH_MODE=local`, remove the Authentik NPM Advanced config for this host (leave NPM
   as a plain TLS proxy to `frontend:80`), and `docker compose up -d`.
8. Sign in at `https://timekeeper.yourdomain.com/login` with username/email + password + TOTP.

Keep `SESSION_SECRET` and `MFA_ENCRYPTION_KEY` stable across restarts. Changing the MFA key makes
every enrolled secret unreadable.

### Fresh database

On a brand-new production database with `AUTH_MODE=local`:

1. Set `ADMIN_EMAIL`, `SESSION_SECRET` and `MFA_ENCRYPTION_KEY` in `.env`.
2. `docker compose up -d --build`.
3. Read the boot logs. The backend creates the first administrator and prints a one-time,
   60-minute reset code:

   ```
   FIRST ADMINISTRATOR CREATED
     email:      you@example.com
     reset code: <single-use code>
   ```

4. Open `/reset?code=<code>`, set the password, then sign in and enrol TOTP.
5. The code works once and is not printed again. No password is generated or logged.

### Rollback to Authentik

The proxy path is still supported, so rollback is configuration:

1. Set `AUTH_MODE=proxy`, keeping `INTERNAL_PROXY_SECRET` set.
2. Restore the NPM forward-auth Advanced config for the Time Keeper host (see
   [Proxy mode](#proxy-mode-optional)).
3. `docker compose up -d`.

Local accounts and passwords remain in the database. Switching back to `local` re-enables them;
the proxy path resolves the same `users` row by email.

---

## Proxy mode (optional)

This section is the pre-accounts Authentik/NPM setup, retained because `AUTH_MODE=proxy` and
`hybrid` still work and are tested. Skip it entirely for a default local deployment.

### Headers the backend reads

| Header | Value | Used as |
|--------|-------|---------|
| `X-authentik-email` | User's email address | Resolved to `users.id`; stored with every record |
| `X-authentik-username` | Username | Passed through, not used |
| `X-authentik-uid` | OIDC `sub` (UUID) | Passed through, not used |

An email the app has never seen is provisioned as a `users` row on first sight, with an unusable
password and `must_set_password` — the pre-Phase-A behaviour.

### Trust model (C-1)

The `X-authentik-email` header is trusted only when **all** of these hold:

1. **Trusted peer.** The TCP peer (`req.socket.remoteAddress`, never client-controlled
   `X-Forwarded-For`) is loopback, private (RFC 1918 / IPv6 ULA / link-local), or inside
   `TRUSTED_PROXY_CIDRS`.
2. **Internal token.** In production the request also carries `X-Internal-Token` equal to
   `INTERNAL_PROXY_SECRET`. nginx injects it server-side and overwrites any client value.
3. **Same origin** for non-GET header-authenticated requests.

**Nginx must never be the only hop.** It forwards whatever `X-authentik-email` arrives and stamps
the token on top. Publishing `frontend:80` would let anyone who can reach it authenticate as any
email. That is why no host port is published.

### Authentik setup

1. **Create a Proxy Provider:** Authentik Admin → Applications → Providers → Create → Proxy
   Provider. Name `time-keeper`, mode **Forward auth (single application)**, external host
   `https://timekeeper.yourdomain.com`.
2. **Create an Application** linked to that provider (slug `time-keeper`).
3. **Add it to your proxy outpost:** Applications → Outposts → edit the proxy outpost → add
   `Time Keeper` → Save. It reconfigures within a few seconds.

### Nginx Proxy Manager setup

1. **Proxy Hosts → Add Proxy Host.**
2. **Details:** domain `timekeeper.yourdomain.com`, scheme `http`, forward hostname `frontend`
   (the Docker service name on `proxy-net`), port `80`, websockets on.
3. **SSL:** select/request a certificate, force SSL.
4. **Advanced:** paste the standard Authentik NPM forward-auth template. The key lines set the
   identity header:

   ```nginx
   auth_request_set $authentik_email $upstream_http_x_authentik_email;
   proxy_set_header X-authentik-email $authentik_email;
   ```

   Replace the outpost `proxy_pass` URL with your Authentik instance:

   ```nginx
   location /outpost.goauthentik.io {
       proxy_pass http://<your-authentik-host>:9000/outpost.goauthentik.io;
       ...
   }
   ```

### Using a different identity provider

The app only reads the email of the authenticated user. Any reverse proxy + IdP that can set a
trusted email header works. Change the header nginx forwards, or rename the header the backend
reads in `packages/backend/src/middleware/auth.ts`:

| Setup | Header | nginx line |
|-------|--------|------------|
| **Authentik** (embedded outpost) | `X-authentik-email` | default |
| **Authelia** | `Remote-Email` | `proxy_set_header X-authentik-email $http_remote_email;` |
| **Keycloak** (oauth2-proxy) | `X-Auth-Request-Email` | `proxy_set_header X-authentik-email $http_x_auth_request_email;` |
| **Cloudflare Access** | `Cf-Access-Authenticated-User-Email` | `proxy_set_header X-authentik-email $http_cf_access_authenticated_user_email;` |
| **Caddy + caddy-security** | `X-Forwarded-User` | set the header in Caddy |

Whatever you choose must satisfy the trust model above.

---

## Development

### Local mode (the default, and the real login path)

```bash
yarn workspace @time-keeper/backend dev
```

With `AUTH_MODE` unset (local) and `NODE_ENV` not production, boot seeds a development
administrator if it does not exist:

- email `admin@localhost`, username `devadmin`, role `admin`
- password from `DEV_ADMIN_PASSWORD`, or a random one printed **once** at creation

Sign in at http://localhost:5173/login with those credentials. This is the path that exercises the
real login, session and MFA code.

```bash
DEV_ADMIN_PASSWORD='a long dev passphrase' yarn workspace @time-keeper/backend dev
```

The seed never resets an existing `admin@localhost`, so a restart does not silently change the
password you are using.

### Proxy mode development

`DEV_USER_ID` exists only for `AUTH_MODE=proxy`:

```bash
AUTH_MODE=proxy DEV_USER_ID=you@example.com yarn workspace @time-keeper/backend dev
```

All data is stored under that value; no Authentik setup is needed locally. In `local` mode
`DEV_USER_ID` is ignored by design.

### Docker dev overlay

`docker-compose.dev.yml` sets `NODE_ENV=development`, `AUTH_MODE=local` and
`DEV_ADMIN_PASSWORD` (default `dev-admin-password`), so the containerised dev stack uses the same
real login flow: `admin@localhost` / `devadmin`. `DEV_USER_ID` is not set; it is a proxy-mode-only
shortcut. Sessions and encrypted MFA secrets use ephemeral keys in dev, so they reset when the
container restarts. See [docs/operations/local-dev.md](../operations/local-dev.md).

---

## Configuration reference

| Variable | Required | Purpose |
|----------|----------|---------|
| `AUTH_MODE` | No (default `local`) | `local`, `proxy` or `hybrid`. Anything else refuses to boot |
| `SESSION_SECRET` | Yes in production (≥32 chars) | Signs/derives session material. Rotating it signs everyone out |
| `MFA_ENCRYPTION_KEY` | Yes in production (32 bytes, base64/hex) | AES-256-GCM key for TOTP secrets. **Changing it invalidates every enrolled secret** |
| `ADMIN_EMAIL` | Yes | Account promoted to admin. On a migrated DB it must match an existing email; on an empty DB it is created with a printed reset code |
| `INTERNAL_PROXY_SECRET` | Yes when `AUTH_MODE=proxy`/`hybrid` | Shared secret between frontend nginx and backend |
| `TRUSTED_PROXY_CIDRS` | No | Extra CIDRs for the proxy peer check |
| `DEV_ADMIN_PASSWORD` | No | Dev-only password for the seeded `admin@localhost` |
| `DEV_USER_ID` | No | Dev-only identity bypass, `AUTH_MODE=proxy` only |

Generate the secrets with:

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # MFA_ENCRYPTION_KEY (or: openssl rand -hex 32)
openssl rand -hex 32      # INTERNAL_PROXY_SECRET (proxy mode only)
```

---

## Troubleshooting

**Local mode: login returns 401 for a correct password**
Check `AUTH_MODE` is `local` or `hybrid` (a `proxy`-only deployment returns 404 on `/api/auth/login`
by design), and check the account is not disabled or `must_set_password`. A `must_set_password`
account needs a reset code before it can log in.

**Local mode: 403 `reauthentication_required` on a sensitive action**
The session is older than five minutes. Sign out and back in, then retry. This is the Q17 freshness
gate, not a permission failure.

**Local mode: admin pages are missing entirely**
Non-admins get 404 and the Settings entry point is hidden. If you are the admin, check the account
is `role='admin'` and that `ADMIN_EMAIL` matched it at boot. A session-authenticated admin without
MFA gets `mfa_enrolment_required`; enrol TOTP at `/account`.

**Boot fails: `Invalid production configuration`**
The error names each missing variable. Generate the secrets above; in proxy mode also set
`INTERNAL_PROXY_SECRET`.

**Boot fails: `ADMIN_EMAIL … matches no user`**
On a migrated database this is fatal on purpose: `ADMIN_EMAIL` must be one of the pre-existing
emails. Fix `.env` to the right address. (On a truly empty database the first admin is created
instead.)

**Proxy mode: 401 after a successful Authentik login**
In order:
1. `INTERNAL_PROXY_SECRET` is set in `.env` and matches in both containers.
2. The NPM Advanced config sets `proxy_set_header X-authentik-email $authentik_email`.
3. The frontend nginx forwards the header and stamps `X-Internal-Token`.
4. The outpost is healthy in Authentik Admin → Outposts.
5. The NPM host is reaching `frontend:80` over `proxy-net`, not a published host port.

**Proxy mode: redirect loop after login**
The Proxy Provider's **External host** must exactly match the domain NPM serves, including
`https://`.

**After cutover, the browser still goes to Authentik**
The NPM forward-auth Advanced config is still attached to the host. Remove it (keep NPM as a plain
TLS reverse proxy to `frontend:80`) and restart the stack.
