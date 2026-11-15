# VPS Deployment Guide

## Prerequisites

- VPS with Docker Engine 24+ and Docker Compose v2
- [Nginx Proxy Manager](https://nginxproxymanager.com) (or another TLS reverse proxy)
- A domain name pointing to your VPS
- **Optional:** an [Authentik](https://goauthentik.io) instance, only if you deploy with
  `AUTH_MODE=proxy` (or `hybrid` for a staged migration)

The app owns authentication by default. No identity provider is required to deploy.

## Step 1: Clone the repository

```bash
git clone https://github.com/niels-emmer/time-keeper.git /opt/time-keeper
cd /opt/time-keeper
```

## Step 2: Create the .env file

```bash
cp .env.example .env
```

Fill in the four auth values. `AUTH_MODE` defaults to `local`.

```bash
# Session secret, at least 32 characters (rotating it signs everyone out)
openssl rand -base64 48        # → SESSION_SECRET

# 32-byte key that encrypts TOTP secrets at rest
openssl rand -base64 32        # → MFA_ENCRYPTION_KEY  (or: openssl rand -hex 32)

# The account promoted to role=admin at boot
#   migrated database: must be one of the pre-existing emails
#   brand-new database: created at boot, with a one-time reset code printed to the logs
ADMIN_EMAIL=you@example.com
```

**Warning — `MFA_ENCRYPTION_KEY` is durable.** Changing it makes every enrolled TOTP secret
unreadable. Affected users must re-enrol MFA. Keep it stable and back it up separately from the
database (a database backup alone cannot decrypt the secrets without this key).

`INTERNAL_PROXY_SECRET` is required **only** when `AUTH_MODE` is `proxy` or `hybrid`:

```bash
openssl rand -hex 32           # → INTERNAL_PROXY_SECRET (proxy mode only)
```

## Step 3: Start the containers

```bash
APP_VERSION=$(git describe --tags --abbrev=0) docker compose up -d --build
```

This starts two containers on the external `proxy-net` Docker network:
- `frontend` — nginx serving the React SPA, proxies `/api/*` to the backend
- `backend` — Express API with SQLite

Verify they're running:

```bash
docker compose ps
docker compose logs backend   # "Database migrations applied", then "running on port 3001"
```

### First administrator

- **Fresh database:** boot creates the account named by `ADMIN_EMAIL` and prints a one-time,
  60-minute reset code:

  ```text
  FIRST ADMINISTRATOR CREATED
    email:      you@example.com
    reset code: <single-use code>
  ```

  Open `https://timekeeper.yourdomain.com/reset?code=<code>` (or `/reset` and paste it), choose a
  password of at least 12 characters, then sign in at `/login`. The code works once. No password is
  generated or logged.

- **Migrated database:** `ADMIN_EMAIL` must match an existing account, and boot fails loudly if it
  does not. Follow the cutover procedure below before switching `AUTH_MODE` to `local`.

## Step 4: Configure Nginx Proxy Manager

Add a proxy host:
- **Forward to:** `frontend:80` — the Docker service name on the external `proxy-net` network.
  Attach NPM to the same `proxy-net` network; do **not** publish the frontend port to the host (see
  [docs/integration/docker.md](../integration/docker.md#network-layout)).
- **SSL:** enabled, force HTTPS.

For the default local mode, that is the whole NPM configuration: a TLS reverse proxy. **Do not**
attach Authentik forward auth unless you are running `AUTH_MODE=proxy`.

### Optional: Authentik forward auth (`AUTH_MODE=proxy`)

1. Create a **Proxy Provider** (mode: Forward auth, external host:
   `https://timekeeper.yourdomain.com`).
2. Create an **Application** linked to that provider.
3. Add the application to your existing **proxy outpost**.
4. Paste the standard Authentik NPM forward-auth template into the host's Advanced tab.

Full walkthrough: [docs/integration/auth.md](../integration/auth.md#proxy-mode-optional).

## Step 5: Verify

Open `https://timekeeper.yourdomain.com`.

- `AUTH_MODE=local` (default): you land on the app's own sign-in page. Sign in with the admin
  account, enrol TOTP at `/account`, and create the first normal user from **Settings → Users**
  (invite or direct create + reset code).
- `AUTH_MODE=proxy`: you are redirected to Authentik's login page; after logging in you land on
  the Time Keeper home screen.

## Cutover from Authentik to local auth

Use this for an existing deployment with real data. It is also the only way a **migrated**
account (which has no password) can be given one, because the proxy path is available during the
window.

1. **Back up** with the WAL-safe snapshot ([runbooks](runbooks.md#rb-006-wal-safe-backup)) and
   rehearse the Phase A migration on a copy ([migration-phase-a.md](migration-phase-a.md)).
2. Set `AUTH_MODE=hybrid`, keep `INTERNAL_PROXY_SECRET` and the NPM forward-auth config, and
   restart.
3. Sign in through Authentik as the `ADMIN_EMAIL` account.
4. In **Settings → Users**, issue a reset code for every account (including your own).
5. Each person opens `/reset?code=…` and sets a password. This clears `must_set_password`.
6. As the admin, open `/account` and enrol TOTP (required for admin features once you are on a
   local session).
7. Set `AUTH_MODE=local`, remove the Authentik Advanced config from the NPM host (leave it as a
   plain TLS proxy to `frontend:80`), and run `docker compose up -d`.
8. Sign in at `/login`.

### Rollback to Authentik

1. Set `AUTH_MODE=proxy` (keep `INTERNAL_PROXY_SECRET`).
2. Restore the NPM forward-auth Advanced config for the host.
3. `docker compose up -d`.

Local passwords and accounts stay in the database, so you can switch back to `local` later.

## Updating

```bash
cd /opt/time-keeper
./refresh-vps.sh
```

The root helper script runs `git pull --ff-only --tags`, exports `APP_VERSION` from the latest git
tag, and rebuilds the `frontend` and `backend` services with Docker Compose. The `APP_VERSION`
variable bakes the latest git tag into the backend image so the Settings → About section shows the
correct version. Docker rebuilds only changed layers. The SQLite database is preserved in the
`db-data` volume.

If `APP_VERSION` is omitted, the image falls back to the latest git tag available in the clone, then
to the version in `packages/backend/package.json`.

## Backup

The entire application state is a single SQLite file, but WAL mode means the file alone is not a
consistent snapshot while the backend is running (finding M-5). Use the online `better-sqlite3`
backup, or stop the backend first. Full detail, cron, and verification:
[runbooks.md#rb-006-wal-safe-backup](runbooks.md#rb-006-wal-safe-backup).

The file now also contains accounts, live sessions and encrypted MFA secrets. Back it up together
with `MFA_ENCRYPTION_KEY`: without the key, the TOTP secrets in a restored database cannot be
decrypted.

```bash
mkdir -p /opt/time-keeper/backups
docker compose exec -T backend node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('/data/time-keeper.db');
db.backup('/data/backup.db')
  .then(() => { db.close(); console.log('WAL-safe snapshot written to /data/backup.db'); })
  .catch((error) => { console.error(error); process.exit(1); });
NODE
docker compose cp backend:/data/backup.db "/opt/time-keeper/backups/time-keeper-$(date +%Y%m%d).db"
docker compose exec backend rm /data/backup.db
```

Daily cron job:

```cron
0 2 * * * cd /opt/time-keeper && docker compose exec -T backend node -e "const D=require('better-sqlite3');const db=new D('/data/time-keeper.db');db.backup('/data/backup.db').then(()=>db.close()).catch((e)=>{console.error(e);process.exit(1);})" && docker compose cp backend:/data/backup.db backups/time-keeper-$(date +\%Y\%m\%d).db && docker compose exec -T backend rm -f /data/backup.db
```

## Restore

```bash
docker compose stop backend
docker compose cp /opt/time-keeper/backups/time-keeper-YYYYMMDD.db backend:/data/time-keeper.db
# remove stale WAL/SHM from the replaced database, or SQLite may replay them
docker compose run --rm --entrypoint sh backend -c 'rm -f /data/time-keeper.db-wal /data/time-keeper.db-shm'
docker compose start backend
```

Verify with the restore drill in [runbooks.md#rb-007-restore-drill](runbooks.md#rb-007-restore-drill).

Restoring a snapshot also restores the sessions that were live at that moment. To force everyone
to sign in again, sign out other devices from `/account` after the restore.
