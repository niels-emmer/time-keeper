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

This secret prevents header injection attacks on the `api.*` subdomain (see [docs/integration/api-subdomain.md](../integration/api-subdomain.md)).

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
- **Forward to:** `192.168.x.x:38521` (your server's LAN IP — use `ip a` to find it; do **not** use `127.0.0.1` if NPM runs in Docker)
- **SSL:** enabled, force HTTPS
- **Advanced tab:** paste the standard Authentik NPM forward auth template (same block you use for other protected apps)

See [docs/integration/auth.md](../integration/auth.md) for the exact NPM config.

## Step 6: Verify

Open `https://timekeeper.yourdomain.com` in a browser. You should be redirected to Authentik's login page. After logging in you land on the Time Keeper home screen.

## Updating

```bash
cd /opt/time-keeper
git pull
APP_VERSION=$(git describe --tags --abbrev=0) docker compose up -d --build
```

The `APP_VERSION` variable bakes the latest git tag into the backend image so the Settings → About section shows the correct version. Docker rebuilds only changed layers. The SQLite database is preserved in the `db-data` volume.

## Backup

The entire application state is a single SQLite file:

```bash
mkdir -p /opt/time-keeper/backups
docker compose cp backend:/data/time-keeper.db /opt/time-keeper/backups/time-keeper-$(date +%Y%m%d).db
```

Daily cron job:

```cron
0 2 * * * cd /opt/time-keeper && docker compose cp backend:/data/time-keeper.db backups/time-keeper-$(date +\%Y\%m\%d).db
```

## Restore

```bash
docker compose stop backend
docker compose cp /opt/time-keeper/backups/time-keeper-YYYYMMDD.db backend:/data/time-keeper.db
docker compose start backend
```
