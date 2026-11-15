# Local Development

## Prerequisites

- Node.js 22 or later
- Corepack enabled: `corepack enable` (gives you Yarn 4)
- Docker (optional, for full-stack test with containers)

## Ports (read this if the backend will not start)

Defaults: backend **3001**, frontend **5173**.

**`3001` is frequently taken on a development machine.** In particular, the Orchestrator desktop app's daemon listens on `3001`, so on a machine running it the backend either fails to bind with `EADDRINUSE` or your browser silently reaches the daemon instead of this API — which looks like a broken app rather than a port conflict. Check before blaming the code:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

Move the backend with `PORT` and tell the frontend where it went with `VITE_API_URL`. **Set both or neither** — the pair is the contract:

```bash
# Terminal 1 — backend on any free port (3101 used here purely as an example)
PORT=3101 DEV_ADMIN_PASSWORD='a long dev passphrase' yarn workspace @time-keeper/backend dev

# Terminal 2 — frontend, pointed at that port
VITE_API_URL=http://localhost:3101 yarn workspace @time-keeper/frontend dev
```

- `PORT` is read by `packages/backend/src/index.ts` (default `3001`).
- `VITE_API_URL` is the Vite dev-server proxy target in `packages/frontend/vite.config.ts` (default `http://localhost:3001`).

If you set only one of them, the UI keeps calling the old port and you get a stream of 404s/502s in the browser console instead of a startup error. There is deliberately no committed non-default port: the default stays `3001`, and the override is per-shell so it does not surprise anyone else on the project.

## Option A: Run directly (fastest)

```bash
# 1. Install dependencies
yarn install

# 2. Start the backend (Terminal 1)
DEV_ADMIN_PASSWORD='a long dev passphrase' yarn workspace @time-keeper/backend dev
# API runs on http://localhost:3001  — see "Ports" above if that is taken

# 3. Start the frontend (Terminal 2)
yarn workspace @time-keeper/frontend dev
# UI runs on http://localhost:5173
```

Both `dev` scripts build `@time-keeper/shared` first, so this works from a clean checkout with no extra step. Yarn 4 does not run `pre`/`post` lifecycle hooks for arbitrary scripts, so the build is chained explicitly in the script rather than declared as a `predev` hook.

The frontend Vite dev server proxies `/api/*` to `VITE_API_URL` (default `http://localhost:3001`) automatically — see `packages/frontend/vite.config.ts`.

Open http://localhost:5173/login and sign in as username `devadmin` (email `admin@localhost`) with
the password you set in `DEV_ADMIN_PASSWORD`. If you did not set it, the password was generated once
and printed at first boot — it is **not** a fixed development password. No OAuth2 / Authentik is
needed: this is the real local login, session and MFA path.

## Auth in development

`AUTH_MODE` defaults to `local`, and that is the path development is meant to exercise. On first
boot (non-production, local/hybrid mode) the backend seeds a development administrator:

- email `admin@localhost`, username `devadmin`, role `admin`
- password from `DEV_ADMIN_PASSWORD`, or a random one printed **once** at creation
- an existing `admin@localhost` is never reset, so a restart does not change your credentials

```bash
DEV_ADMIN_PASSWORD='a long dev passphrase' yarn workspace @time-keeper/backend dev
```

Sign in at http://localhost:5173/login. Enrol TOTP at `/account` if you want to exercise the second
step (any authenticator app works; the ten recovery codes are shown once).

**Enrolled MFA stops working when the backend restarts.** Development has no
`MFA_ENCRYPTION_KEY`, so the process generates an ephemeral one; a restart makes the stored
secret undecryptable and every authenticator code invalid. If you want enrolment to survive
restarts, generate a key **once**, save it, and pass the same value every time:

```bash
# once
openssl rand -base64 32 > .dev-mfa.key     # do not commit this file

# every run
MFA_ENCRYPTION_KEY="$(cat .dev-mfa.key)" DEV_ADMIN_PASSWORD='a long dev passphrase' \
  yarn workspace @time-keeper/backend dev
```

Without a saved key, the way back in is to clear the enrolment. Sign-in will keep asking for a code
that can never verify, so there is no UI path; either delete the development database
(`dev-data/time-keeper.db*`) and let it re-seed, or clear the flag directly:

```bash
sqlite3 dev-data/time-keeper.db \
  "UPDATE users SET mfa_enabled = 0, mfa_secret_enc = NULL, mfa_last_step = NULL WHERE username = 'devadmin';"
```

`DEV_USER_ID` is a **proxy-mode-only** shortcut and is ignored in local mode:

```bash
AUTH_MODE=proxy DEV_USER_ID=you@example.com yarn workspace @time-keeper/backend dev
```

Sessions use an ephemeral `SESSION_SECRET` in development unless you set one, so they reset when
the process restarts.

## Option B: Run with Docker Compose (dev mode)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- Local login with the seeded dev admin (`admin@localhost` / `devadmin`, or
  `DEV_ADMIN_PASSWORD` from the dev overlay)
- Sessions and MFA keys are ephemeral in the dev overlay, so they reset on restart

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

## Running tests

```bash
# Shared utilities (rounding algorithm, etc.)
yarn workspace @time-keeper/shared test          # run once
yarn workspace @time-keeper/shared test:watch    # watch mode

# Backend in the default (local) auth mode
yarn workspace @time-keeper/backend test

# The same suite against the optional proxy header path
yarn workspace @time-keeper/backend test:proxy

# Frontend (theme utilities)
yarn workspace @time-keeper/frontend test
```

## TypeScript

The workspace uses TypeScript project references. If your editor shows type errors in the frontend for shared types, make sure `packages/shared` is built or pointed to via the `exports` field in its `package.json`.
