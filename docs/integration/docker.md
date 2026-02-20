# Docker Integration

## Service map

| Service | Image | Port (internal) | Port (host) | Role |
|---------|-------|-----------------|-------------|------|
| `frontend` | Built from `packages/frontend/Dockerfile` | 80 | `0.0.0.0:38521` | Serves React SPA, proxies `/api/*` to backend |
| `backend` | Built from `packages/backend/Dockerfile` | 3001 | — (internal only) | Express API + SQLite |

Auth is not a Docker service — it is handled by Authentik's embedded outpost running inside your existing Authentik stack, integrated via NPM forward auth.

## Network layout

Both services are on the `app` bridge network. The frontend exposes port `38521` on all interfaces (`0.0.0.0`) so NPM can reach it via the server's LAN IP. NPM proxies to this port after the Authentik auth check passes.

```
Internet → NPM (SSL, LAN IP:38521) → Authentik outpost (auth check) → 192.168.x.x:38521 (frontend)

Docker network (app):
  frontend:80 (nginx)
      └── /api/* → backend:3001 (Express)
```

> **Note:** Do not use `127.0.0.1:38521` in NPM if NPM itself runs in Docker — it will resolve to NPM's own loopback, not the host. Use the server's LAN IP instead.

## Volumes

| Volume | Mount | Contents |
|--------|-------|----------|
| `db-data` | `/data` in `backend` | SQLite database file (`time-keeper.db`) |

**Backup**: `docker compose cp backend:/data/time-keeper.db ./backup.db`

## Build contexts

Both Dockerfiles use the **repo root** as the build context (`.`). This is required because both need `packages/shared/` — the shared TypeScript types and utilities package. The build process compiles `shared` first, then the target package.

## Environment variables

| Variable | Set by | Purpose |
|----------|--------|---------|
| `APP_VERSION` | Build arg (`--build-arg APP_VERSION=...`) | Git tag baked into the backend image; served by `GET /api/info` and shown in Settings → About. Falls back to `"dev"` if not set. |
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
| `GET /api/health` | No | Docker healthcheck; returns `{"status":"ok","version":"0.1.0"}` |
| `GET /api/info` | Yes | Returns `{ version, repoUrl, user }` — shown in Settings → About |
| `GET /api/settings` | Yes | Returns `{ weeklyGoalHours, roundingIncrementMinutes }` — user's configurable weekly target and rounding granularity |
| `PUT /api/settings` | Yes | Update `{ weeklyGoalHours }` (integer, 0–40) and/or `{ roundingIncrementMinutes }` (30 or 60) |
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

Manual verification:
```bash
# Health (no auth needed)
docker compose exec backend wget -qO- http://localhost:3001/api/health

# Info (requires auth header)
docker compose exec backend wget -qO- http://localhost:3001/api/info \
  --header="X-authentik-email: you@example.com"

# Get weekly goal setting
curl -s http://localhost:38521/api/settings \
  -H "X-authentik-email: you@example.com"

# Test category reorder (from host)
curl -s -X PATCH http://localhost:38521/api/categories/reorder \
  -H "Content-Type: application/json" \
  -H "X-authentik-email: you@example.com" \
  -d '[{"id":1,"sortOrder":0},{"id":2,"sortOrder":1}]'
```
