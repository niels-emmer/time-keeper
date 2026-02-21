# Contributing

Time Keeper is a personal self-hosted tool, built and maintained by its author with the help of AI coding agents. External contributions are welcome but the bar is intentionally high — the project exists to solve one person's workflow, not to become a general-purpose time tracker.

## Before you open a pull request

- **Check the issue tracker first.** If there is no open issue for what you want to change, open one and wait for a response before writing any code.
- **Read the architecture docs.** The decisions log (`docs/memory/decisions.md`) explains why things are the way they are. Please read it before proposing alternatives.
- **Keep changes small and focused.** One feature or fix per PR. Refactoring mixed with feature work will be asked to be split.

## For AI coding agents

Read **[AGENTS.md](AGENTS.md)** — it is the authoritative entry point for agentic work in this repository and supersedes any generic instructions.

## Development setup

See [docs/operations/local-dev.md](docs/operations/local-dev.md) for the full local development guide.

Quick start:

```bash
corepack enable
yarn install

# Terminal 1 — backend
DEV_USER_ID=you@example.com yarn workspace @time-keeper/backend dev

# Terminal 2 — frontend
yarn workspace @time-keeper/frontend dev
```

Open http://localhost:5173.

## Running tests

```bash
yarn workspace @time-keeper/shared test
yarn workspace @time-keeper/backend test
```

## Code style

- TypeScript strict mode throughout — no `any`, no `// @ts-ignore`
- Tailwind for styling — no inline styles, no CSS modules
- React Query for all server state — no `useEffect` + `fetch` patterns
- shadcn/ui for UI primitives — check `packages/frontend/src/components/ui/` before reaching for a new library

## Security

See [SECURITY.md](SECURITY.md) for the security posture of this project. Any PR that adds npm dependencies, changes the API surface, or touches auth must update `SECURITY.md` as part of the same commit.
