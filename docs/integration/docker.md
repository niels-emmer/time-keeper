# Docker Integration

## Service map

| Service | Image | Port (internal) | Port (external) | Role |
|---------|-------|-----------------|-----------------|------|
| `oauth2-proxy` | `quay.io/oauth2-proxy/oauth2-proxy:v7.6.0` | 4180 | 4180 | Auth gate; entry point from SSL proxy |
| `frontend` | Built from `packages/frontend/Dockerfile` | 80 | — | Serves React SPA, proxies `/api/*` to backend |
| `backend` | Built from `packages/backend/Dockerfile` | 3001 | — | Express API + SQLite |

## Network layout

All services are on the `app` bridge network. Only `oauth2-proxy` exposes a port to the host (4180). Your SSL terminator (nginx/caddy on the host) proxies to `localhost:4180`.

```
Host machine:
  [your SSL proxy] → localhost:4180 (oauth2-proxy)

Docker network (app):
  oauth2-proxy → frontend:80 (nginx)
                     ↓ /api/*
                 backend:3001 (Express)
```

## Volumes

| Volume | Mount | Contents |
|--------|-------|----------|
| `db-data` | `/data` in `backend` | SQLite database file (`time-keeper.db`) |

**Backup**: `docker compose cp backend:/data/time-keeper.db ./backup.db`

## Build contexts

Both Dockerfiles use the **repo root** as the build context (`.`), not the package directory. This is required because:
- The backend Dockerfile needs to copy `packages/shared/` to build shared types
- The frontend Dockerfile needs `packages/shared/` for the API type imports

## Environment variables

All variables are defined in `.env` (gitignored). See `.env.example` for the full list.

In development, only `DEV_USER_ID` is needed (no OAuth2 variables required).

## Compose files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Production configuration |
| `docker-compose.dev.yml` | Development overlay (hot reload, no auth) |

To run in development:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Health checks

The backend exposes `GET /api/health` which returns `{"status":"ok","version":"0.1.0"}`. This is excluded from oauth2-proxy authentication so Docker can poll it without credentials. The frontend depends on the backend being healthy before starting.
