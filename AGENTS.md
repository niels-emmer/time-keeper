# AGENTS.md — Time Keeper

This file is the entry point for AI coding agents working in this repository.

## First steps in every session

1. Read **`docs/memory/INDEX.md`** — it tells you what the project is, where things live, and what to read next based on your task.
2. Check **`docs/memory/invariants.md`** before making architectural changes.
3. Check **`docs/memory/decisions.md`** to understand past choices before proposing alternatives.

## Quick facts

| Item | Value |
|------|-------|
| Package manager | Yarn 4 (workspaces) |
| Backend | Node.js + Express + Drizzle ORM + SQLite |
| Frontend | React + Vite + Tailwind + shadcn/ui |
| Auth | oauth2-proxy sidecar (OIDC via Authentik) |
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
```
