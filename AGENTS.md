# AGENTS.md — Time Keeper

This file is the entry point for AI coding agents working in this repository.

## First steps in every session

1. Read **`docs/memory/INDEX.md`** — it tells you what the project is, where things live, and what to read next based on your task.
2. Check **`docs/memory/invariants.md`** before making architectural changes.
3. Check **`docs/memory/decisions.md`** to understand past choices before proposing alternatives.

## Standing requirement — SECURITY.md

**`SECURITY.md` must be kept up to date.** After any work session that touches dependencies, API surface, auth flow, data storage, or new libraries, review `SECURITY.md` and update it before committing. Specifically:

- **New dependency added** → add a row to the dependency table with its risk profile; run `yarn npm audit` and update the audit date/result.
- **New API endpoint** → check whether it changes the authenticated surface; note it in the threat model if relevant.
- **Auth or middleware changes** → re-evaluate the "Authentication" section.
- **Schema or storage changes** → re-evaluate the "Data storage" section.
- **Anything not yet audited** → add it to the "What has not been done" list.

If none of those apply to a session, no update is needed — but explicitly confirm this before finishing.

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

# Build all
yarn workspace @time-keeper/backend build
yarn workspace @time-keeper/frontend build
```

## Repository layout

```
packages/shared    # Shared TypeScript types + rounding algorithm
packages/backend   # Express API
packages/frontend  # React PWA
docs/memory/       # Architectural memory (read every session)
docs/integration/  # Auth, Docker, PWA integration details
docs/operations/   # How to run, deploy, fix
SECURITY.md        # Security posture — keep current (see standing requirement above)
```
