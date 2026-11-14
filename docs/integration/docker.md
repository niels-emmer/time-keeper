# Docker Integration

## Service map

| Service | Image | Port (internal) | Port (host) | Role |
|---------|-------|-----------------|-------------|------|
| `frontend` | Built from `packages/frontend/Dockerfile` | 80 | — (none; `frontend:80` on `proxy-net`) | Serves React SPA, proxies `/api/*` to backend |
| `backend` | Built from `packages/backend/Dockerfile` | 3001 | — (none; `backend:3001` on `proxy-net`) | Express API + SQLite |

Auth is not a Docker service — it is handled by Authentik's embedded outpost running inside your existing Authentik stack, integrated via NPM forward auth. In production, set `INTERNAL_PROXY_SECRET` in `.env` before starting the stack or the backend will refuse to trust browser-auth headers.

## Network layout

Both services attach to the external `proxy-net` Docker network and publish **no host ports**. NPM must be attached to the same `proxy-net` network; it reaches the frontend as `frontend:80` and the backend as `backend:3001` by Docker service name. Nothing on the host, the LAN, or the internet can connect to either container port directly.

```
Internet
  └── NPM (TLS + Authentik forward auth; attached to proxy-net)
        ├── frontend:80 (nginx)
        │     └── /api/* → backend:3001 (Express)
        └── api.* host (TLS only) → backend:3001 (Bearer token check)

Docker network (proxy-net):
  frontend:80 (nginx)
      └── /api/* → backend:3001 (Express)
```

> **Security (C-1): do not add a `ports:` mapping for either service.** The frontend nginx blindly forwards `X-authentik-email` to the backend and stamps `X-Internal-Token` onto whatever request arrives. If `:80` were published, anyone who can connect to it could authenticate as any email they choose. Nginx must never be the only hop in front of the backend. As defence in depth, the backend also rejects the header path unless the TCP peer is loopback/private or in `TRUSTED_PROXY_CIDRS`.

## Volumes

| Volume | Mount | Contents |
|--------|-------|----------|
| `db-data` | `/data` in `backend` | SQLite database file (`time-keeper.db`) |

**Backup**: do not copy the `.db` file while the backend is running — WAL mode keeps recent commits in `time-keeper.db-wal`, so a plain copy can silently miss the newest entries (finding M-5). Use the WAL-safe snapshot in [docs/operations/runbooks.md](../operations/runbooks.md#rb-006-wal-safe-backup) (online, `sqlite3 .backup`-equivalent via the bundled `better-sqlite3`) or stop the backend before copying. The image does not ship the `sqlite3` CLI.

```bash
# Online, consistent snapshot (no downtime)
docker compose exec -T backend node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('/data/time-keeper.db');
db.backup('/data/backup.db')
  .then(() => { db.close(); console.log('WAL-safe snapshot written to /data/backup.db'); })
  .catch((error) => { console.error(error); process.exit(1); });
NODE
docker compose cp backend:/data/backup.db ./time-keeper-$(date +%Y%m%d).db
docker compose exec backend rm /data/backup.db
```

## Build contexts

Both Dockerfiles use the **repo root** as the build context (`.`). This is required because both need `packages/shared/` — the shared TypeScript types and utilities package. The build process compiles `shared` first, then the target package.

## Environment variables

| Variable | Set by | Purpose |
|----------|--------|---------|
| `APP_VERSION` | Build arg (`--build-arg APP_VERSION=...`) | Optional explicit version override; served by `GET /api/info` and shown in Settings → About. Falls back to the latest git tag in the clone, then `packages/backend/package.json`. |
| `INTERNAL_PROXY_SECRET` | `.env` / deployment secret | Shared secret between frontend nginx and backend. Required in production so the backend only trusts `X-authentik-email` when the proxied request also carries a matching `X-Internal-Token`. |
| `TRUSTED_PROXY_CIDRS` | `.env` / deployment secret (optional) | Comma-separated CIDRs that **extend** the backend's built-in loopback/RFC 1918 allowlist for the `X-authentik-email` peer check. Leave unset for the default single-host topology, where nginx and the backend share `proxy-net`. |
| `DEV_USER_ID` | Shell env (dev only) | Email address to use as the user identity in dev mode (bypasses auth) |

Pass `APP_VERSION` at build time:
```bash
APP_VERSION=$(git describe --tags --abbrev=0) docker compose up -d --build
```

## Compose files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Production |
| `docker-compose.dev.yml` | Development overlay (hot reload, no auth) |

To run in development:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## API endpoints (internal reference)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/health` | No | Docker healthcheck; returns `{"status":"ok","version":"<current>"}` |
| `GET /api/info` | Yes | Returns `{ version, repoUrl, user }` — shown in Settings → About |
| `GET /api/settings` | Yes | Returns `{ weeklyGoalHours, roundingIncrementMinutes, timezone }` — weekly target, rounding granularity, and the IANA zone used for local-day bucketing |
| `PUT /api/settings` | Yes | Update `{ weeklyGoalHours }` (integer, 0–40) and/or `{ roundingIncrementMinutes }` (30 or 60) and/or `{ timezone }` (IANA zone, e.g. `Europe/Amsterdam`) |
| `GET /api/categories` | Yes | List categories ordered by `sort_order ASC` |
| `POST /api/categories` | Yes | Create category (auto-assigns `sort_order`) |
| `PUT /api/categories/:id` | Yes | Update a category |
| `DELETE /api/categories/:id` | Yes | Delete a category |
| `PATCH /api/categories/reorder` | Yes | Bulk-set `sort_order`; body: `[{id, sortOrder}]` |
| `GET /api/timer` | Yes | Active timer status |
| `POST /api/timer/start` | Yes | Start timer with `{ categoryId }` |
| `POST /api/timer/stop` | Yes | Stop active timer |
| `GET /api/entries` | Yes | Time entries by `?date=YYYY-MM-DD` or `?week=YYYY-WNN` |
| `PATCH /api/entries/:id` | Yes | Update a time entry |
| `DELETE /api/entries/:id` | Yes | Delete a time entry |
| `GET /api/summary/weekly` | Yes | Weekly summary (optionally `?week=YYYY-WNN`); `goalMinutes` reflects user setting |
| `POST /api/summary/round` | Yes | Apply end-of-day rounding with `{ date }`; cap = user's weekly goal |
| `POST /api/summary/round-week` | Yes | Apply rounding to all days of an ISO week `{ week: 'YYYY-WNN' }`; idempotent |

Manual verification (nothing is published to the host, so run these inside the Docker network):

```bash
# Health (no auth needed; run inside the backend container)
docker compose exec backend wget -qO- http://localhost:3001/api/health

# Authentik-header path through nginx. The frontend container is already on
# proxy-net, and nginx stamps X-Internal-Token itself.
docker compose exec frontend sh -c \
  'wget -qO- --header="X-authentik-email: you@example.com" http://localhost/api/info'

# Get weekly goal setting (same path)
docker compose exec frontend sh -c \
  'wget -qO- --header="X-authentik-email: you@example.com" http://localhost/api/settings'

# Test category reorder from a container attached to proxy-net
docker run --rm --network proxy-net curlimages/curl -s -X PATCH \
  http://frontend/api/categories/reorder \
  -H "Content-Type: application/json" \
  -H "X-authentik-email: you@example.com" \
  -d '[{"id":1,"sortOrder":0},{"id":2,"sortOrder":1}]'
```
