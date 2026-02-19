# Docker Integration

## Service map

| Service | Image | Port (internal) | Port (host) | Role |
|---------|-------|-----------------|-------------|------|
| `frontend` | Built from `packages/frontend/Dockerfile` | 80 | `127.0.0.1:38521` | Serves React SPA, proxies `/api/*` to backend |
| `backend` | Built from `packages/backend/Dockerfile` | 3001 | — (internal only) | Express API + SQLite |

Auth is not a Docker service — it is handled by Authentik's embedded outpost running inside your existing Authentik stack, integrated via NPM forward auth.

## Network layout

Both services are on the `app` bridge network. Only the frontend exposes a port to the host (`127.0.0.1:38521`). NPM proxies to this port after the Authentik auth check passes.

```
Host machine:
  NPM (SSL) → Authentik outpost (auth check) → localhost:38521 (frontend)

Docker network (app):
  frontend:80 (nginx)
      └── /api/* → backend:3001 (Express)
```

## Volumes

| Volume | Mount | Contents |
|--------|-------|----------|
| `db-data` | `/data` in `backend` | SQLite database file (`time-keeper.db`) |

**Backup**: `docker compose cp backend:/data/time-keeper.db ./backup.db`

## Build contexts

Both Dockerfiles use the **repo root** as the build context (`.`). This is required because both need `packages/shared/` — the shared TypeScript types and utilities package. The build process compiles `shared` first, then the target package.

## Environment variables

There are no required environment variables for production. Auth is handled externally by Authentik and NPM.

For development only:

| Variable | Purpose |
|----------|---------|
| `DEV_USER_ID` | Email address to use as the user identity in dev mode (bypasses auth) |

## Compose files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Production |
| `docker-compose.dev.yml` | Development overlay (hot reload, no auth) |

To run in development:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Health check

The backend exposes `GET /api/health` → `{"status":"ok","version":"0.1.0"}`. The frontend container waits for this to return healthy before starting. It is also useful for manual verification:

```bash
docker compose exec backend wget -qO- http://localhost:3001/api/health
```
