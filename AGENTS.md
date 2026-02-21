# AGENTS.md — Time Keeper

This file is the entry point for AI coding agents working in this repository.

## First steps in every session

1. Read **`docs/memory/INDEX.md`** — it tells you what the project is, where things live, and what to read next based on your task.
2. Check **`docs/memory/invariants.md`** before making architectural changes.
3. Check **`docs/memory/decisions.md`** to understand past choices before proposing alternatives.

## Standing requirements — living documents

The following files must be kept in sync with the codebase. Update them in the same commit as the feature or fix they describe — never let them lag behind.

### SECURITY.md

After any work session that touches dependencies, API surface, auth flow, data storage, or new libraries:

- **New dependency added** → add a row to the dependency table with its risk profile; run `yarn npm audit` and update the audit date/result.
- **New API endpoint** → check whether it changes the authenticated surface; note it in the threat model if relevant.
- **Auth or middleware changes** → re-evaluate the "Authentication" section.
- **Schema or storage changes** → re-evaluate the "Data storage" section.
- **Anything not yet audited** → add it to the "What has not been done" list.

If none of those apply to a session, no update is needed — but explicitly confirm this before finishing.

### CONTRIBUTING.md

Update when: dev setup changes, new tooling is added, code style rules change, or the contribution process itself changes.

### README.md

Update when: the feature set changes visibly, UI screenshots are regenerated, or setup/deploy instructions change.

### docs/screenshots/ (track.png, weekly.png, settings.png)

After any release that visibly changes the UI, suggest regenerating these screenshots. See `docs/memory/INDEX.md` for the screenshot capture conventions.

## Quick facts

| Item | Value |
|------|-------|
| Package manager | Yarn 4 (workspaces) |
| Backend | Node.js + Express + Drizzle ORM + SQLite |
| Frontend | React + Vite + Tailwind + shadcn/ui |
| Auth | Authentik embedded outpost via NPM forward auth (reads `X-authentik-email`) |
| Container | Docker Compose |

## Workspace commands

```bash
# Install deps
yarn install

# Run backend in dev mode
yarn workspace @time-keeper/backend dev

# Run frontend in dev mode
yarn workspace @time-keeper/frontend dev

# Generate DB migrations after schema changes
yarn workspace @time-keeper/backend db:generate

# Run tests
yarn workspace @time-keeper/shared test
yarn workspace @time-keeper/backend test
yarn workspace @time-keeper/frontend test

# Build all
yarn workspace @time-keeper/backend build
yarn workspace @time-keeper/frontend build
```

## Repository layout

```
packages/shared       # Shared TypeScript types + rounding algorithm + unit tests
packages/backend      # Express API (routes, services, Drizzle ORM, SQLite)
packages/frontend     # React PWA (Vite, Tailwind, shadcn/ui, service worker)
docs/memory/          # Architectural memory — read every session
  INDEX.md            #   Start here: project overview, critical files, API routes
  decisions.md        #   ADR log — why things are the way they are
  invariants.md       #   Hard rules that must never be broken
  incidents.md        #   Root causes of past problems and fixes
docs/integration/     # Auth, Docker, PWA integration details
  auth.md             #   Authentik + NPM forward auth setup
  docker.md           #   Container layout and networking
  pwa.md              #   Installing on macOS and Android
docs/operations/      # How to run, deploy, troubleshoot
  local-dev.md        #   Full local development guide
  deployment.md       #   Production deploy steps
  runbooks.md         #   Common break/fix procedures
docs/screenshots/     # PNG screenshots (track, weekly, settings) — 390×844px
SECURITY.md           # Security posture — keep current (see standing requirements above)
CONTRIBUTING.md       # Contributor guide — keep current
```
