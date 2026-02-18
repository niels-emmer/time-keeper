# Local Development

## Prerequisites

- Node.js 22 or later
- Corepack enabled: `corepack enable` (gives you Yarn 4)
- Docker (optional, for full-stack test with containers)

## Option A: Run directly (fastest)

```bash
# 1. Install dependencies
yarn install

# 2. Start the backend (Terminal 1)
DEV_USER_ID=you@example.com yarn workspace @time-keeper/backend dev
# API runs on http://localhost:3001

# 3. Start the frontend (Terminal 2)
yarn workspace @time-keeper/frontend dev
# UI runs on http://localhost:5173
```

The frontend Vite dev server proxies `/api/*` to `http://localhost:3001` automatically (configured in `vite.config.ts`).

No OAuth2 / Authentik needed. The backend uses `DEV_USER_ID` as the user identity.

## Option B: Run with Docker Compose (dev mode)

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- No oauth2-proxy in dev mode

## Database

The SQLite database is created automatically on first run.

- Direct run: `./dev-data/time-keeper.db`
- Docker dev: same path, bind-mounted from host

**Reset the database:**
```bash
rm -rf dev-data/
yarn workspace @time-keeper/backend dev  # migrations run again on startup
```

## Generating migrations after schema changes

After editing `packages/backend/src/db/schema.ts`:

```bash
yarn workspace @time-keeper/backend db:generate
```

This creates a new SQL file in `packages/backend/drizzle/`. Commit it alongside the schema change. Migrations run automatically when the backend starts.

## TypeScript

The workspace uses TypeScript project references. If your editor shows type errors in the frontend for shared types, make sure `packages/shared` is built or pointed to via the `exports` field in its `package.json`.
