# AGENTS.md — Time Keeper

Pi should load this file together with `.pi/APPEND_SYSTEM.md` when supported by the runtime.

Use this file as the just-in-time routing index for agentic work in this repository.

## Canonical bootstrap order

Read these in this order unless the task is extremely narrow:

1. `.pi/APPEND_SYSTEM.md` — minimal always-on operating contract for this repo
2. `.pi-rules` — durable workspace laws
3. `.pi-context` — concise session bootstrap summary
4. `CONTEXT.md` — concise domain and architectural context
5. `docs/memory/INDEX.md` — full project map and task routing
6. `docs/memory/invariants.md` before architectural changes
7. `docs/memory/decisions.md` before proposing alternatives
8. `.pi/settings.json` when project-local Pi packages or extensions matter

## Project-local Pi catalog

Treat these repo-defined files as the local governance layer:

- `.pi/APPEND_SYSTEM.md` — always-on repo operating contract
- `.pi-rules` — durable workspace rules layered above the generic runtime
- `.pi-context` — concise mission, stack, verification, and doc-sync summary
- `CONTEXT.md` — concise domain model and repository operating model
- `.pi/settings.json` — declares the Pi packages this repo expects in local runs
- `.pi/skills/time-keeper-governance/SKILL.md` — governance baseline for architecture, auth, persistence, API surface, and agent-facing docs
- `.pi/skills/operational-excellence/SKILL.md` — verification scope, doc freshness, and workflow hygiene
- `.pi/skills/delivery-validation/SKILL.md` — choosing and reporting builds/tests
- `.pi/skills/subagent-routing/SKILL.md` — when to keep work in the parent vs delegate to project-local subagents
- `.pi/extensions/workflow-gate.ts` — runtime nudges and gates for explicit Research -> Plan -> Build -> Verify flow
- `.pi/agents/repo-governor.md` — delegated repo-governance and doc-alignment helper
- `.pi/agents/local-builder.md` — local Ollama-backed builder for bounded, low-context tasks
- `.pi/agents/local-reviewer.md` — local Ollama-backed reviewer for bounded, low-context review work
- `.pi/prompts/session-init.md` — lightweight session bootstrap prompt

## Runtime availability note

This repository currently defines three project-local subagents on disk:
- `repo-governor` — governance, memory, and documentation-alignment helper
- `local-builder` — local Ollama-backed builder for bounded code, doc, and test work
- `local-reviewer` — local Ollama-backed reviewer for bounded diffs, plans, docs, and small implementations

Whether they are invokable depends on the active runtime exposing repo-local agents by name.

When available, use them as follows:
- Prefer `local-builder` for small edits, focused refactors, targeted tests, and doc updates.
- Prefer `local-reviewer` for a cheap first-pass review of a small diff, plan, prompt, doc, or bounded implementation.
- Prefer `repo-governor` for governance, memory, and documentation alignment.
- Keep architectural, auth, storage, security, or broad cross-package work in the parent session unless delegation is deliberate.
- Load `.pi/skills/subagent-routing/SKILL.md` when deciding whether to delegate.
- `.pi/extensions/workflow-gate.ts` nudges non-trivial work into explicit Research -> Plan -> Build -> Verify flow and adds `/rpbv-status`, `/rpbv-approve`, and `/rpbv-reset`.

Your Pi runtime may also expose builtin or user-level agents from outside this repository (for example `worker`, `reviewer`, `planner`, or environment-specific Azure/Foundry agents). Treat those as runtime-specific helpers, not repo-defined behavior.

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

### docs/screenshots/ (track.png, weekly.png, monthly.png, settings.png)

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
.pi/                  # Project-local Pi surfaces (APPEND_SYSTEM, skills, agents, prompts, settings)
  agents/             #   Project-local subagents (repo-governor, local-builder, local-reviewer)
  extensions/         #   Runtime workflow enforcement and Pi behavior hooks
  skills/             #   Focused guidance, including subagent routing
.pi-context           # Concise Pi session bootstrap summary
.pi-rules             # Durable workspace laws for this repository
CONTEXT.md            # Concise domain + architectural context for agents
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
docs/screenshots/     # PNG screenshots (track, weekly, monthly, settings) — 390×844px
SECURITY.md           # Security posture — keep current (see standing requirements above)
CONTRIBUTING.md       # Contributor guide — keep current
```
