# VPS Deployment Guide

## Prerequisites on the VPS

- Docker Engine 24+ and Docker Compose v2
- An SSL reverse proxy (nginx or Caddy) already running on the host
- A domain name pointing to the VPS
- Authentik instance running (can be on the same VPS or elsewhere)

## Step 1: Clone the repository

```bash
git clone https://github.com/your-username/time-keeper.git /opt/time-keeper
cd /opt/time-keeper
```

## Step 2: Configure environment

```bash
cp .env.example .env
nano .env  # fill in all values
```

Required values:
- `AUTHENTIK_ISSUER_URL` — from your Authentik OIDC provider
- `OAUTH2_CLIENT_ID` — from Authentik
- `OAUTH2_CLIENT_SECRET` — from Authentik
- `OAUTH2_COOKIE_SECRET` — generate: `openssl rand -base64 32`
- `APP_URL` — e.g. `https://timekeeper.yourdomain.com`

## Step 3: Configure your SSL reverse proxy

The app listens on `localhost:4180` (oauth2-proxy). Point your SSL proxy to this port.

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name timekeeper.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/timekeeper.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/timekeeper.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:4180;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy example

```caddyfile
timekeeper.yourdomain.com {
    reverse_proxy localhost:4180
}
```

## Step 4: Build and start

```bash
cd /opt/time-keeper
docker compose up -d --build
```

## Step 5: Verify

```bash
# Check all services are running
docker compose ps

# Check backend health
curl http://localhost:3001/api/health  # from inside the VPS

# Check logs
docker compose logs -f
```

## Updating

```bash
cd /opt/time-keeper
git pull
docker compose up -d --build
```

Docker Compose will rebuild only changed services and restart them with zero-downtime rolling restarts.

## Backup

The entire application state is in the SQLite file:

```bash
docker compose cp backend:/data/time-keeper.db ./backups/time-keeper-$(date +%Y%m%d).db
```

Set up a cron job to run this daily:
```cron
0 2 * * * cd /opt/time-keeper && docker compose cp backend:/data/time-keeper.db ./backups/time-keeper-$(date +\%Y\%m\%d).db
```

## Restore

```bash
docker compose stop backend
docker compose cp ./backups/time-keeper-20260218.db backend:/data/time-keeper.db
docker compose start backend
```
