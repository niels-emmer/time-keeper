# VPS Deployment Guide

## Prerequisites

- VPS with Docker Engine 24+ and Docker Compose v2
- [Authentik](https://goauthentik.io) instance (can be on the same VPS)
- [Nginx Proxy Manager](https://nginxproxymanager.com) as the SSL reverse proxy
- A domain name pointing to your VPS

## Step 1: Clone the repository

```bash
git clone https://github.com/niels-emmer/time-keeper.git /opt/time-keeper
cd /opt/time-keeper
```

## Step 2: Create the .env file

```bash
cp .env.example .env
```

Generate the internal proxy secret and paste it in:

```bash
openssl rand -hex 32
# → paste the output as INTERNAL_PROXY_SECRET in .env
```

This secret prevents header injection attacks on the `api.*` subdomain (see [docs/integration/api-subdomain.md](../integration/api-subdomain.md)). In production the backend now fails closed without it and will refuse to trust browser-auth headers if it is missing or mismatched.

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
docker compose logs backend   # should show "Database migrations applied" and "running on port 3001"
```

## Step 4: Configure Authentik

See [docs/integration/auth.md](../integration/auth.md) for the full walkthrough. Summary:

1. Create a **Proxy Provider** (mode: Forward auth, external host: `https://timekeeper.yourdomain.com`)
2. Create an **Application** linked to that provider
3. Add the application to your existing **proxy outpost**

## Step 5: Configure Nginx Proxy Manager

Add a proxy host:
- **Forward to:** `frontend:80` — the Docker service name on the external `proxy-net` network. Attach NPM to the same `proxy-net` network; do **not** publish the frontend port to the host (see [docs/integration/docker.md](../integration/docker.md#network-layout)).
- **SSL:** enabled, force HTTPS
- **Advanced tab:** paste the standard Authentik NPM forward auth template (same block you use for other protected apps)

See [docs/integration/auth.md](../integration/auth.md) for the exact NPM config.

## Step 6: Verify

Open `https://timekeeper.yourdomain.com` in a browser. You should be redirected to Authentik's login page. After logging in you land on the Time Keeper home screen.

## Updating

```bash
cd /opt/time-keeper
./refresh-vps.sh
```

The root helper script runs `git pull --ff-only --tags`, exports `APP_VERSION` from the latest git tag, and rebuilds the `frontend` and `backend` services with Docker Compose. The `APP_VERSION` variable bakes the latest git tag into the backend image so the Settings → About section shows the correct version. Docker rebuilds only changed layers. The SQLite database is preserved in the `db-data` volume.
If `APP_VERSION` is omitted, the image now falls back to the latest git tag available in the clone, then to the version in `packages/backend/package.json`.

## Backup

The entire application state is a single SQLite file, but WAL mode means the file alone is not a consistent snapshot while the backend is running (finding M-5). Use the online `better-sqlite3` backup, or stop the backend first. Full detail, cron, and verification: [runbooks.md#rb-006-wal-safe-backup](runbooks.md#rb-006-wal-safe-backup).

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
