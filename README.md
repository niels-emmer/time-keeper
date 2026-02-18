# Time Keeper

A personal work-timer PWA for tracking time across Workday categories. Runs on macOS (installable from Safari/Chrome) and Android (installable from Chrome). Hosted in Docker on a private VPS, behind an SSL reverse proxy with Authentik authentication.

## Features

- **One-tap timer start** — tap a category to start tracking, tap Stop to finish
- **Auto-stop** — starting a new category stops the previous one automatically
- **Weekly overview** — see time per category per day, copy to clipboard for Workday
- **End-of-day rounding** — round minutes up to whole hours (capped at 40h/week)
- **PWA** — installs on macOS Dock and Android home screen, works in standalone mode

## Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| Backend | Node.js 22 + Express + Drizzle ORM |
| Database | SQLite (better-sqlite3, WAL mode) |
| Auth | oauth2-proxy → Authentik (OIDC) |
| Container | Docker Compose |

## Local development

### Prerequisites
- Node.js 22+
- Yarn 4 (`corepack enable`)
- Docker (optional, for full-stack testing)

### Run without Docker

```bash
# Install dependencies
yarn install

# Terminal 1 — backend (API on :3001)
DEV_USER_ID=dev@localhost yarn workspace @time-keeper/backend dev

# Terminal 2 — frontend (Vite dev server on :5173)
yarn workspace @time-keeper/frontend dev
```

Open http://localhost:5173. No auth is required in dev mode.

### Run with Docker (dev)

```bash
cp .env.example .env
# Edit .env if needed (DEV_USER_ID is set automatically in dev compose)

docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Deployment

See [docs/operations/deployment.md](docs/operations/deployment.md) for VPS deployment steps including SSL proxy configuration and Authentik setup.

## Documentation

| Path | Contents |
|------|----------|
| [AGENTS.md](AGENTS.md) | Entry point for AI coding agents |
| [docs/memory/INDEX.md](docs/memory/INDEX.md) | Architectural memory index |
| [docs/integration/auth.md](docs/integration/auth.md) | oauth2-proxy + Authentik wiring |
| [docs/integration/docker.md](docs/integration/docker.md) | Docker services and volumes |
| [docs/operations/deployment.md](docs/operations/deployment.md) | Production deployment guide |
