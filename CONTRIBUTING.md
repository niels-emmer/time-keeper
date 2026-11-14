# Contributing

Time Keeper is a personal self-hosted tool, built and maintained by its author with the help of AI coding agents. External contributions are welcome but the bar is intentionally high — the project exists to solve one person's workflow, not to become a general-purpose time tracker.

## Before you open a pull request

- **Check the issue tracker first.** If there is no open issue for what you want to change, open one and wait for a response before writing any code.
- **Read the architecture docs.** The decisions log (`docs/memory/decisions.md`) explains why things are the way they are. Please read it before proposing alternatives.
- **Keep changes small and focused.** One feature or fix per PR. Refactoring mixed with feature work will be asked to be split.

## For AI coding agents

Read **[AGENTS.md](AGENTS.md)** first — it is the authoritative routing index for agentic work in this repository and supersedes any generic instructions.

Project-local Pi governance lives in `AGENTS.md` and the repo-local Pi surfaces it catalogs: `.pi/APPEND_SYSTEM.md`, `.pi-rules`, `.pi-context`, `CONTEXT.md`, `.pi/settings.json`, `.pi/extensions/`, `.pi/skills/`, `.pi/agents/`, and `.pi/prompts/session-init.md`.

Your Pi runtime may also expose builtin or user-level agents from outside this repository; treat those as environment-specific unless this repo documents them explicitly.

## Development setup

See [docs/operations/local-dev.md](docs/operations/local-dev.md) for the full local development guide.

For production/VPS refreshes, use the root helper script `./refresh-vps.sh` described in [docs/operations/deployment.md](docs/operations/deployment.md); it wraps `git pull`, sets `APP_VERSION` from the latest git tag, and rebuilds the frontend and backend containers.

### Node version

- **Node 26** is the canonical development runtime (see `.node-version` and the `engines.node` field in `package.json`).
- **Node 22** is the floor and is what the container images run (`node:22-alpine`).
- Anything `>=22` is supported. CI runs the full suite on **both 22 and 26** so a change cannot silently work in only one of them.

`better-sqlite3` is pinned to `^13` for exactly this reason: 13.x installs on Node 22 and Node 26, where 11.x failed to compile on Node 26.

Quick start:

```bash
corepack enable
yarn install

# Terminal 1 — backend
DEV_USER_ID=you@example.com yarn workspace @time-keeper/backend dev

# Terminal 2 — frontend
yarn workspace @time-keeper/frontend dev
```

Then open http://localhost:5173.

## Running tests

```bash
yarn workspace @time-keeper/shared test
yarn workspace @time-keeper/backend test
yarn workspace @time-keeper/frontend test
```

Each backend/frontend `test` script builds `@time-keeper/shared` first, so a clean checkout works without a separate build step (Yarn 4 does not run `pretest` hooks, so the build is chained explicitly rather than declared as `pretest`). The backend suite runs against an in-memory SQLite database and never touches `./dev-data/`.

CI (`.github/workflows/ci.yml`) runs install, build, and all three suites on Node 22 and 26, and fails on any red step.

## Code style

- TypeScript strict mode throughout — no `any`, no `// @ts-ignore`
- Tailwind for styling — no inline styles, no CSS modules
- React Query for all server state — no `useEffect` + `fetch` patterns
- shadcn/ui for UI primitives — check `packages/frontend/src/components/ui/` before reaching for a new library

## Security

See [SECURITY.md](SECURITY.md) for the security posture of this project. Any PR that adds npm dependencies, changes the API surface, or touches auth must update `SECURITY.md` as part of the same commit.
