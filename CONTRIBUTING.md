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

- **Node 26** is the canonical development runtime (`.node-version` pins `26`; `package.json` allows `engines.node >= 22`).
- **Node 22** is the floor and is what the container images run (`node:22-alpine`).
- Anything `>=22` is supported. CI runs the full suite on **both 22 and 26** so a change cannot silently work in only one of them.

`better-sqlite3` is pinned to `^13` for exactly this reason: 13.x ships prebuilt binaries for every supported platform, where 11.x failed to compile against Node 26.

### Docker-based verification

A normal `yarn install` works on the host for Node 22 and 26 on macOS and Linux, because `better-sqlite3` 13 ships the compiled `.node` binaries inside the package and the root `package.json` disables its build scripts — nothing is compiled at install time. The old "works in Docker, broken on the host" split came from `better-sqlite3` 11, which had to compile C++ and could not do so on Node 26.

Run the backend suite in a container when you want to verify against the **production runtime**, or when your platform has no prebuild (install then fails loudly instead of falling back to node-gyp):

```bash
docker run --rm -v "$PWD":/src:ro -w /app node:22-bookworm-slim sh -c '
  cp -a /src/. /app/ && rm -rf node_modules &&
  npm install --global corepack@latest >/dev/null 2>&1 && corepack enable &&
  yarn install --immutable &&
  yarn workspace @time-keeper/shared build &&
  yarn workspace @time-keeper/backend test'
```

Expected tail: all backend test files and tests pass, with the proxy-only suites skipped in the
default (`local`) mode. The backend suite runs against an in-memory SQLite database, so the
container needs no volume and leaves nothing behind.

Quick start:

```bash
corepack enable
yarn install

# Terminal 1 — backend (seeds admin@localhost / devadmin on first run)
DEV_ADMIN_PASSWORD='a long dev passphrase' yarn workspace @time-keeper/backend dev

# Terminal 2 — frontend
yarn workspace @time-keeper/frontend dev
```

Then open http://localhost:5173/login and sign in with `admin@localhost` and that password. This is
the real local auth path; `DEV_USER_ID` is a `AUTH_MODE=proxy`-only shortcut. See
[docs/operations/local-dev.md](docs/operations/local-dev.md#auth-in-development).

## Running tests

```bash
yarn workspace @time-keeper/shared test
yarn workspace @time-keeper/backend test        # AUTH_MODE=local (the default)
yarn workspace @time-keeper/backend test:proxy  # the optional proxy header path
yarn workspace @time-keeper/frontend test
```

Each backend/frontend `test` **and `dev`** script builds `@time-keeper/shared` first, so a clean checkout works without a separate build step (Yarn 4 does not run `pretest`/`predev` hooks, so the build is chained explicitly inside the script rather than declared as a lifecycle hook). The backend suite runs against an in-memory SQLite database and never touches `./dev-data/`.

CI (`.github/workflows/ci.yml`) runs install, build, and all three suites on Node 22 and 26, plus
the backend suite again under `AUTH_MODE=proxy`, and fails on any red step. Auth changes must keep
both modes green: proxy-only suites declare their skip explicitly (and vice versa).

## Code style

- TypeScript strict mode throughout — no `any`, no `// @ts-ignore`
- Tailwind for styling — no inline styles, no CSS modules
- React Query for all server state — no `useEffect` + `fetch` patterns
- shadcn/ui for UI primitives — check `packages/frontend/src/components/ui/` before reaching for a new library

## Security

See [SECURITY.md](SECURITY.md) for the security posture of this project. Any PR that adds npm dependencies, changes the API surface, or touches auth must update `SECURITY.md` as part of the same commit.
