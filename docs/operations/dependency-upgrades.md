# Deferred dependency upgrades

> The single list of upgrades this project has **decided not to do yet**, why, and what
> would make it do them. Read this before re-opening a Dependabot PR that was closed, and
> before assuming a major bump is "just a version change".
>
> Related: `SECURITY.md` → "Dependency audit" (advisory triage and acceptance rationale),
> `docs/memory/INDEX.md` (task routing), `AGENTS.md` (standing doc-sync requirements).

The rule this file enforces: **a closed Dependabot PR or an accepted advisory is a decision,
not an oversight.** Every entry below names the trigger that reopens it. If a trigger fires
and the entry is stale, update it in the same PR that acts on it.

## How to take an upgrade here

An upgrade is done when the gate below is green — not when `yarn install` succeeds.

1. Branch from `origin/main` (never a stale local `main`): the container and CI both pin
   Node 22 while the host runs Node 26, so both are real targets.
2. `yarn workspace @time-keeper/shared test` — 46 tests, 3 files. (A local run on a tree
   where `packages/shared/dist` exists reports **92**: `tsc` emits the compiled
   `*.test.js` next to the sources and `vitest` picks both up. CI runs on a clean checkout
   and sees 46, so 46 is the number to compare against.)
3. `yarn workspace @time-keeper/backend test` **and** `test:proxy` — 367 / 373 tests. The
   proxy suite is skipped in local mode and vice versa; a change that touches auth or
   middleware must pass both.
4. `yarn workspace @time-keeper/frontend test` — 127 tests — then **look at the UI**. The
   frontend suite does not see styling regressions, and neither does CI.
5. Both builds (`backend`, `frontend`), and a clean `git status` afterwards — a build that
   writes into the tree fails CI.
6. Anything in the **runtime** image: build `packages/backend/Dockerfile` and boot it with
   `NODE_ENV=production`, real secrets, and a throwaway database. Watch the **log**, not
   just the process: `express-rate-limit` 8 reports misconfiguration through its logger,
   so a live process proves nothing.
7. Update `SECURITY.md` (dependency table, audit date, advisory triage) and `CONTRIBUTING.md`
   if the tooling changed.
8. Four checks green: `build-and-test (22)`, `build-and-test (26)`, `audit`, `trivy`.

## React 18 → 19

| | |
|---|---|
| Current | `react` / `react-dom` 18.3.1, `@types/react` 18.x |
| Target | React 19 + `@types/react` 19 |
| Status | **deferred** — Dependabot PR #38 closed as stale (conflicting against `main`, predating ~3 months of lockfile churn) |

What the earlier assessment got wrong, and what is already done: the testing-library half of
this upgrade is **already satisfied**. `@testing-library/react` is 16.3.2, whose peers accept
`react ^18 || ^19`, and the frontend suite contains no React-18-only API — no
`react-dom/test-utils`, no `ReactDOM.render`, no `findDOMNode`, no `defaultProps`. So this is
a four-package major (`react`, `react-dom`, `@types/react`, `@types/react-dom`), not a
test-harness migration.

Remaining risk:

- React 19 changes concurrent-rendering defaults; the timer UI relies on a worker for its
  clock, so rendering timing bugs surface as wrong *displayed* time, not failed tests.
- `recharts` 3.8 and `react-is` resolve against React's internals; check their React 19
  support before bumping, and do not upgrade them in the same commit.
- `act()` semantics tighten for async transitions; some of the 127 tests may need
  `await act(...)` or `findBy*` instead of `getBy*`.

**Trigger to do it:** a feature needs a React 19 API, React 18 leaves security support, or
`recharts`/`react-router-dom` stop supporting 18. **Gate:** 127 frontend tests plus a manual
pass over Track / Weekly / Monthly / Settings at 390 px, since the suite cannot see layout.

## Tailwind CSS 3 → 4 (with `tailwind-merge` 2 → 3)

| | |
|---|---|
| Current | `tailwindcss` 3.4.19 (declared `^3.4.15`), `tailwind-merge` 2.6.1 |
| Target | Tailwind 4 + `tailwind-merge` 3 |
| Status | **deferred, and coupled** — Dependabot PR #77 (`tailwind-merge` 3) closed rather than merged |

These two move together or not at all. `tailwind-merge` v3 encodes Tailwind v4's class
groups; against Tailwind 3 it mis-resolves conflicts in `cn()`/`twMerge`, and the failure
mode is **silent**: the wrong utility wins, with no error and no test failure. Merging #77
alone would have been a styling bug shipped as a version bump.

What a Tailwind 4 migration actually costs here:

- v4 is CSS-first: `@tailwind base/components/utilities` in `src/index.css` is replaced by a
  single `@import "tailwindcss"` plus `@theme` tokens; the JS `tailwind.config.js` (which
  carries an `extend` block) becomes optional at best and translated at worst.
- The PostCSS integration moves to a separate `@tailwindcss/postcss` package, so
  `postcss.config.js` changes too.
- Removed/renamed utilities and changed default border/ring colours; dark mode via the
  `class` strategy needs re-verifying because the app toggles `.dark` on `<html>`.
- The custom colour tokens in `src/index.css` (`:root` / `.dark`) must be re-expressed; a
  token that silently resolves to nothing looks like a plain unstyled page.

**Trigger to do it:** a v4-only capability is needed, Tailwind 3 stops receiving fixes, or
the styling surface is being reworked anyway. **Gate:** 127 frontend tests (weak here), a
visual pass over all four screens at 390 px, and regenerated `docs/screenshots/*.png` —
per `docs/memory/INDEX.md` → Screenshot conventions.

## Remaining security advisories

Three advisories are **accepted**, not pending. The full rationale lives in
`SECURITY.md` → "Dependency audit"; the operative trigger for each is repeated here so this
file is the one place to check.

| Package | Severity | Advisory | Fixed in | Why accepted | Revisit when |
|---|---|---|---|---|---|
| `minimatch` | medium | GHSA-g3hv-75wg-m249 | 11.0.1 | build/test only (10.2.5 under `glob`); needs a hostile glob *pattern* from build config, never from a request | `glob`/`cacache`/`workbox-build` move to `minimatch@11` |
| `glob` | medium | GHSA-3g3m-2fjr-6pw4 | 14.0.2 | build/test only (11.1.0, 13.0.5 under `cacache`, `workbox-build`); needs caller-controlled pattern + `AbortSignal` cancellation | `workbox-build`/`cacache` accept `glob@14` |
| `deepmerge` | low | GHSA-gcqx-w48m-w2h4 | **none published** | build/test only (4.3.1 under `@rollup/plugin-node-resolve`); no patched release exists | a fixed release is published — or the package enters the runtime image |

All three are absent from the runtime image because `packages/backend/Dockerfile` installs
with `yarn workspaces focus --production`. **Any of them appearing in the production image is
itself the trigger**: re-triage immediately rather than waiting for a release.

CI fails on `yarn npm audit --recursive --severity high` on every PR, so an advisory that
crosses the high threshold cannot slip in behind these acceptances.

## Considered, not scheduled: Express 4 → 5

`express@5.3.0` is available and this repo is on `^4.22.3`. It is not deferred because of
pain — it is simply not needed: 4.22.3 is what raises Express's `qs` requirement above the
four advisories this project was carrying, so the security reason to jump a major is gone.

A v5 migration would touch the routing layer (path-to-regexp syntax, `req.query` becoming a
getter, removed `res.sendfile`/`res.json(status, obj)` forms, async error propagation), and
the middleware chain in `app.ts` is load-bearing for auth, CSRF and rate limiting — the
highest-value code in the repo to avoid churning.

**Trigger:** Express 4 stops receiving security patches, or a v5-only fix is needed.

## Closed Dependabot PRs

| PR | What | Why closed |
|---|---|---|
| #38 | `react` 18 → 19 | stale branch, conflicting, and a migration rather than a bump — see "React 18 → 19" above |
| #77 | `tailwind-merge` 2 → 3 | targets Tailwind 4 class groups while this repo is on Tailwind 3; silent mis-resolution — see above |
| #76 | `express-rate-limit` 7 → 8 | superseded by #85, which carries the same bump plus the verification this major needs (trust proxy, IPv6 keying, `/api/auth` buckets) and a regression test |

The pattern: close the bot PR when it cannot carry the work, and land an equivalent change
that does — with the reasoning recorded. Do not merge a major because CI is green; CI does
not run the container boot, the proxy suite in both modes, or the UI.
