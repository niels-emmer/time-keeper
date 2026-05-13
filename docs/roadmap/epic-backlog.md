# Time Keeper Epic Backlog

This backlog breaks the five proposed product improvements into implementation epics, then into small, shippable slices.

## Guardrails

All phases in this backlog must preserve the repository invariants documented in `docs/memory/invariants.md` and `AGENTS.md`:

- Authentik + Nginx Proxy Manager forward-auth remains the browser/PWA auth boundary
- one active timer per user
- SQLite remains the only persistent application state
- timestamps remain UTC ISO 8601 in storage
- documentation stays aligned with verified code changes

## Delivery model

Each epic should follow the same loop:

1. Research the exact current surface
2. Plan the next smallest slice
3. Build only that slice
4. Verify with the narrowest credible checks
5. Update docs only when triggered

## Prioritization

1. Epic 1 — Track screen speed and focus
2. Epic 2 — Weekly handoff and export workflow
3. Epic 3 — Daily log and entry history
4. Epic 4 — Monthly actionable planning
5. Epic 5 — PWA update and connectivity polish

---

# Epic 1 — Track screen speed and focus

## Goal
Reduce the time and effort required to start the correct timer on the Track screen, especially for users with many categories.

## Current surface
- `packages/frontend/src/components/CategoryGrid.tsx`
- `packages/frontend/src/components/ActiveTimer.tsx`
- `packages/frontend/src/pages/Home.tsx`
- related timer/category hooks

## Success criteria
- Users can identify the active timer instantly
- Users can find a category faster than scrolling through the full grid
- The Track screen scales better as category count grows
- No change to the one-active-timer invariant

## Slice 1.1 — Active timer prominence

### Outcome
Make the active timer state visually obvious on the Track screen.

### Scope
- strengthen active card contrast, hierarchy, and affordances
- tighten visual connection between `ActiveTimer` and the active category card
- improve empty/idle vs active state clarity

### Likely files
- `packages/frontend/src/components/CategoryGrid.tsx`
- `packages/frontend/src/components/ActiveTimer.tsx`
- `packages/frontend/src/pages/Home.tsx`

### Acceptance criteria
- active category is unambiguous at a glance
- active state remains clear in both light and dark themes
- switching categories still works exactly as before

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual: start timer, switch category, stop timer

### Docs
- none unless visible screenshots or README copy need updating later

### Risks
- over-styling could reduce readability on small screens

---

## Slice 1.2 — Search/filter on Track

### Outcome
Allow users to narrow the visible category set quickly.

### Scope
- add a search input above the category grid
- filter by category name and workday code
- show a clear no-results state
- ensure the active category remains discoverable

### Likely files
- `packages/frontend/src/components/CategoryGrid.tsx`
- `packages/frontend/src/pages/Home.tsx`
- new small filter/search utility if needed

### Acceptance criteria
- typing filters categories in real time
- clearing the search restores the full list
- filter matching works for both category name and workday code

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual: verify behavior with 10+ categories

### Docs
- update `README.md` when this ships if the Track experience changed meaningfully

### Risks
- active category may disappear if filtering is implemented naïvely

---

## Slice 1.3 — Recent categories rail

### Outcome
Surface likely-next categories before the full grid.

### Scope
- add a recent/used-this-week section above the main grid
- derive recency from existing timer/entry data before adding any new persistence
- dedupe recent items against the full list

### Likely files
- `packages/frontend/src/pages/Home.tsx`
- `packages/frontend/src/components/CategoryGrid.tsx`
- new frontend hook for recent category derivation
- `packages/frontend/src/lib/api.ts` only if an extra read path is required

### Acceptance criteria
- recent categories appear in sensible order
- active category can appear in recent and remain clearly marked
- the full grid still remains available below

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual: verify ordering after multiple start/stop cycles across days

### Docs
- update `README.md` if this becomes a visible headline workflow improvement

### Risks
- recency logic can become noisy if not bounded to a sensible period

---

## Slice 1.4 — Track sort modes

### Outcome
Give users explicit control over how categories are presented.

### Scope
- add sort modes: manual, A–Z, recent-first
- preserve manual reorder as the canonical custom ordering mode
- persist sort preference locally first unless server persistence becomes necessary

### Likely files
- `packages/frontend/src/pages/Home.tsx`
- `packages/frontend/src/components/CategoryGrid.tsx`
- local preference utility

### Acceptance criteria
- switching sort mode is instant
- manual order remains intact when returning to manual mode
- sort mode persistence works per device/browser

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual: reorder categories, switch modes, return to manual

### Docs
- update `README.md` if this ships as a user-visible feature

### Risks
- interaction with existing drag-to-reorder could be confusing if labels are weak

---

## Slice 1.5 — Optional pinned categories

### Outcome
Let users keep a few categories permanently at the top.

### Scope
- add pin/unpin affordance
- decide whether this is device-local or user-persisted
- if persisted, add backend/category support and migration

### Likely files
Frontend:
- `packages/frontend/src/components/CategoryGrid.tsx`
- `packages/frontend/src/components/CategoryManager.tsx`
- category hooks/client code

If server-persisted:
- `packages/backend/src/db/schema.ts`
- `packages/backend/src/routes/categories.ts`
- `packages/backend/src/routes/categories.test.ts`
- `packages/backend/drizzle/*`

### Acceptance criteria
- pinned categories always appear first in supported modes
- pin state survives refresh
- existing category CRUD and reorder workflows still work

### Validation
- frontend tests
- backend tests if schema or API changes
- build/test expansion if persistence changes

### Docs
- if schema or API changes: update `SECURITY.md` and `docs/memory/INDEX.md`
- if visible feature ships: update `README.md`

### Risks
- pinned + manual reorder semantics can become hard to explain

## Recommended first pickup for Epic 1
- Slice 1.1 + Slice 1.2 together

## Epic 1 exit criteria
- The Track screen is materially faster to use without changing core timer semantics

---

# Epic 2 — Weekly handoff and export workflow

## Goal
Turn the weekly summary into a polished review-and-submit workflow rather than just a table with CSV export.

## Current surface
- `packages/frontend/src/components/WeeklySummary.tsx`
- summary hooks and weekly summary API payload
- existing CSV export logic embedded in the component

## Success criteria
- users can export/copy in the format they need with minimal friction
- the weekly tab feels like a deliberate handoff flow
- weekly totals remain trustworthy and easy to review

## Slice 2.1 — Extract export formatting logic

### Outcome
Make weekly export formatting reusable and testable.

### Scope
- move CSV serialization out of `WeeklySummary.tsx`
- create formatter utilities for CSV and future copy formats
- add focused tests around formatter output

### Likely files
- `packages/frontend/src/components/WeeklySummary.tsx`
- new export utility module under frontend lib/components
- new frontend tests

### Acceptance criteria
- existing CSV output remains unchanged
- export logic no longer lives inline in the main UI component

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual: export CSV and inspect contents

### Docs
- none

### Risks
- regressions in column ordering or formatting

---

## Slice 2.2 — Copy-to-clipboard workflow

### Outcome
Add a fast paste-oriented weekly handoff action.

### Scope
- add copy action beside or above CSV export
- support at least one human-readable paste format
- show success/failure state in the UI

### Likely files
- `packages/frontend/src/components/WeeklySummary.tsx`
- export/clipboard helpers
- UI feedback component usage if available

### Acceptance criteria
- user can copy a weekly summary with one action
- success feedback is visible and non-blocking
- clipboard failures are handled gracefully

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual: browser clipboard test

### Docs
- update `README.md` when shipped if this becomes a headline workflow improvement

### Risks
- clipboard APIs behave differently across installed PWA vs browser contexts

---

## Slice 2.3 — Format picker and preview

### Outcome
Let users choose the output shape before copying or exporting.

### Scope
- add format selector
- support at least: CSV, plain-text summary, compact paste format
- add preview UI before export/copy

### Likely files
- `packages/frontend/src/components/WeeklySummary.tsx`
- new preview component
- export utility tests

### Acceptance criteria
- switching formats updates the preview instantly
- copy/export uses the selected format
- CSV still downloads with a sensible filename

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual: preview/copy/export for each format

### Docs
- update `README.md`
- consider screenshot refresh for Weekly tab if layout changes substantially

### Risks
- too many format choices can clutter the weekly UI

---

## Slice 2.4 — Review-before-submit panel

### Outcome
Make the weekly workflow feel complete and confidence-building.

### Scope
- add a compact review section with total hours, goal comparison, and any rounding context
- make the order of operations clear: review → copy/export
- improve CTA hierarchy

### Likely files
- `packages/frontend/src/components/WeeklySummary.tsx`
- small presentational helper components if needed

### Acceptance criteria
- key weekly totals are readable without scanning the full table
- copy/export actions feel secondary to review, not buried below it

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual visual and interaction pass

### Docs
- update `README.md` if the weekly experience materially changes

### Risks
- the weekly tab could become too dense on mobile widths

---

## Slice 2.5 — Persist last-used export mode

### Outcome
Reduce repeated setup work for the weekly ritual.

### Scope
- remember chosen export mode per device/browser
- restore it on next weekly visit

### Likely files
- `packages/frontend/src/components/WeeklySummary.tsx`
- local preference helper

### Acceptance criteria
- chosen mode survives refresh and later visits
- reasonable default still applies for first-time users

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual: select mode, refresh, revisit

### Docs
- likely covered in the same `README.md` update as earlier slices

### Risks
- local preference persistence can conflict with future server-side settings if overdesigned now

## Recommended first pickup for Epic 2
- Slice 2.1 + Slice 2.2

## Epic 2 exit criteria
- Weekly review feels like a complete handoff workflow with low-friction output options

---

# Epic 3 — Daily log and entry history

## Goal
Give users a trustworthy way to inspect, edit, and eventually backfill the actual time entries behind weekly totals.

## Current surface
- backend entry routes already exist for date/week reads and update/delete
- weekly cell editing exists in `WeeklySummary.tsx`
- no dedicated day-level history UI is currently documented

## Success criteria
- users can inspect what happened on a given day
- users can repair mistakes at the entry level
- users can distinguish entry editing from total-cell editing

## Slice 3.1 — Read-only daily log

### Outcome
Expose a day-level list of entries without changing backend APIs.

### Scope
- add a daily log view, sheet, dialog, or route
- fetch entries by date using existing API
- show category, start time, end time, duration, and running state
- provide entry point from Weekly tab and optionally today on Track

### Likely files
- new daily log component/page
- `packages/frontend/src/components/WeeklySummary.tsx`
- entry hooks/client accessors

### Acceptance criteria
- user can open a date and inspect all entries for that day
- durations match weekly totals for that date
- running timers are handled cleanly for today

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual: verify a date with multiple entries and a date with none

### Docs
- update `README.md` only once the feature becomes user-visible and stable

### Risks
- unclear navigation model can make the feature feel bolted on

---

## Slice 3.2 — Entry edit/delete from daily log

### Outcome
Allow direct correction of underlying entries.

### Scope
- add edit dialog/form for existing entries
- add delete affordance with confirmation
- reuse existing backend update/delete routes

### Likely files
- new daily log UI components
- `packages/frontend/src/lib/api.ts`
- new or expanded entry hooks

### Acceptance criteria
- edited entries reflow into weekly and monthly views correctly
- deleting an entry refreshes the relevant summaries
- ownership and auth rules remain unchanged

### Validation
- `yarn workspace @time-keeper/frontend test`
- `yarn workspace @time-keeper/backend test` if backend behavior gaps are found
- manual regression against weekly totals

### Docs
- likely `README.md` once entry editing is a user-facing feature

### Risks
- invalid time edits can create confusing overlaps if the UI does not validate well

---

## Slice 3.3 — Day navigation and context

### Outcome
Turn the daily log into a practical correction workspace.

### Scope
- add previous/next day navigation
- add jump-to-date support
- add a compact day summary header

### Likely files
- daily log page/component
- date utilities

### Acceptance criteria
- user can move across dates without leaving the daily log context
- header shows day total and useful metadata

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual date-boundary tests

### Docs
- same `README.md` update as the daily log feature rollout

### Risks
- navigation state can become inconsistent if the feature is implemented as a modal without clear URL/state ownership

---

## Slice 3.4 — Manual add/backfill entry

### Outcome
Allow users to add a missing historical entry.

### Scope
- add `POST /api/entries`
- support category + start + end for completed entries
- validate ownership and valid time ranges server-side
- refresh downstream weekly/monthly summaries after creation

### Likely files
Backend:
- `packages/backend/src/routes/entries.ts`
- `packages/backend/src/routes/*test.ts` or new entry tests
- service/helper files if needed

Frontend:
- daily log add-entry UI
- `packages/frontend/src/lib/api.ts`
- entry hooks

### Acceptance criteria
- user can create a historical entry for a selected date
- invalid ranges are rejected clearly
- new entries appear in daily, weekly, and monthly views

### Validation
- `yarn workspace @time-keeper/backend test`
- `yarn workspace @time-keeper/frontend test`
- build checks if cross-package contract changes warrant them

### Docs
- update `SECURITY.md` for the new API endpoint
- update `docs/memory/INDEX.md` route map
- update `README.md` when the feature is visible

### Risks
- time-range validation can be tricky around UTC/local display boundaries

---

## Slice 3.5 — Clarify weekly total edit vs daily entry edit

### Outcome
Make the two correction paths understandable.

### Scope
- add explicit affordances and helper text
- allow users to jump from a weekly cell into the day log
- keep quick total editing available for lightweight changes

### Likely files
- `packages/frontend/src/components/WeeklySummary.tsx`
- daily log components

### Acceptance criteria
- users can understand which tool to use for which correction job
- both flows coexist without ambiguity

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual UX pass

### Docs
- update `README.md` if needed for clarity

### Risks
- too many edit affordances can clutter the weekly table

## Recommended first pickup for Epic 3
- Slice 3.1 alone

## Epic 3 exit criteria
- Users can inspect and correct underlying entries with confidence, not just adjust weekly totals

---

# Epic 4 — Monthly actionable planning

## Goal
Upgrade the Monthly tab from descriptive reporting to decision-support for planning the rest of the month.

## Current surface
- `packages/frontend/src/pages/Monthly.tsx`
- `packages/frontend/src/components/MonthlyOverviewCard.tsx`
- `packages/frontend/src/components/MonthlyGoalsCard.tsx`
- current frontend calculates monthly rollups by fetching overlapping weekly entries client-side

## Success criteria
- users can see which categories need attention immediately
- users can understand remaining effort and current pace
- monthly insights are consistent and testable

## Slice 4.1 — Consolidate monthly summary source

### Outcome
Create a cleaner monthly analytics foundation.

### Scope
- add a backend monthly summary endpoint, ideally under `/api/summary/monthly?month=YYYY-MM`
- centralize per-category actuals, goals, billable split, and month metadata
- remove duplicated monthly calculations from multiple frontend components over time

### Likely files
Backend:
- `packages/backend/src/routes/summary.ts`
- `packages/backend/src/services/summaryService.ts` or a new monthly summary service
- backend tests

Frontend:
- `packages/frontend/src/lib/api.ts`
- monthly hooks/components

### Acceptance criteria
- monthly overview and monthly goals can rely on one canonical data source
- response is scoped to `req.userId`
- data matches existing monthly UI totals

### Validation
- `yarn workspace @time-keeper/backend test`
- `yarn workspace @time-keeper/frontend test`

### Docs
- update `SECURITY.md` for the new endpoint
- update `docs/memory/INDEX.md`

### Risks
- monthly aggregation logic can drift from current frontend behavior if not verified carefully

---

## Slice 4.2 — Category status chips

### Outcome
Show at-a-glance monthly status per category.

### Scope
- add statuses such as on pace, behind, over target, no goal
- surface those statuses in the overview and/or goal list
- sort or group categories more intentionally

### Likely files
- `packages/frontend/src/components/MonthlyOverviewCard.tsx`
- `packages/frontend/src/components/MonthlyGoalsCard.tsx`
- shared monthly status utility

### Acceptance criteria
- categories with problems are visually distinguishable immediately
- status logic is deterministic and test-covered

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual theme/mobile review

### Docs
- update `README.md` when monthly planning becomes more visibly capable

### Risks
- weak thresholds may produce misleading status labels

---

## Slice 4.3 — Remaining-hours and pace guidance

### Outcome
Tell users what pace is required to finish the month well.

### Scope
- compute remaining goal hours by category
- show required pace per week/day for the remainder of the month
- show projected month-end based on current pace

### Likely files
- monthly backend summary or frontend analytics utility
- `packages/frontend/src/components/MonthlyOverviewCard.tsx`

### Acceptance criteria
- projection math is clear and stable
- zero-goal and already-over-goal cases behave sensibly

### Validation
- backend and/or shared math tests
- `yarn workspace @time-keeper/frontend test`

### Docs
- update `README.md` if surfaced prominently

### Risks
- projection math may look authoritative unless explained carefully

---

## Slice 4.4 — Focus panel / exceptions view

### Outcome
Prioritize the few categories that need attention now.

### Scope
- add a focused panel for biggest gaps, overshoots, and billable/non-billable drift
- rank items by urgency rather than listing everything equally

### Likely files
- `packages/frontend/src/pages/Monthly.tsx`
- new monthly insight panel component
- monthly overview refactor as needed

### Acceptance criteria
- users can answer “what should I focus on next?” quickly
- the panel remains useful even with only a few categories

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual review with realistic seed data

### Docs
- update `README.md`
- likely refresh `docs/screenshots/monthly.png`

### Risks
- signal-to-noise ratio may be poor if the ranking rules are not opinionated enough

---

## Slice 4.5 — Month navigation and comparison

### Outcome
Allow review of prior months and near-term comparison.

### Scope
- add month switcher to Monthly tab
- support arbitrary month fetches via the monthly summary endpoint
- optionally compare current month with previous month at a summary level

### Likely files
- `packages/frontend/src/pages/Monthly.tsx`
- monthly hooks/components
- backend monthly summary endpoint if parameterization is incomplete

### Acceptance criteria
- users can navigate to previous months without breaking current-month defaults
- monthly charts/cards update consistently when month changes

### Validation
- `yarn workspace @time-keeper/backend test`
- `yarn workspace @time-keeper/frontend test`

### Docs
- update `README.md`
- likely screenshot refresh if layout changes materially

### Risks
- month navigation adds complexity to a tab currently optimized for “this month”

## Recommended first pickup for Epic 4
- Slice 4.1 + Slice 4.2

## Epic 4 exit criteria
- Monthly planning actively helps users decide how to allocate time for the rest of the month

---

# Epic 5 — PWA update and connectivity polish

## Goal
Make the installed app clearer and more trustworthy when updates are available or connectivity changes.

## Current surface
- `packages/frontend/src/hooks/useServiceWorkerUpdate.ts`
- service worker behavior documented in `docs/integration/pwa.md`
- troubleshooting documented in `docs/operations/runbooks.md`
- current update UX uses blocking `confirm()` prompts

## Success criteria
- update state is visible and non-disruptive
- connectivity issues are explained in-app
- reconnect and refresh behavior feels intentional

## Slice 5.1 — Replace `confirm()` with app-native update UI

### Outcome
Surface SW updates with a banner, toast, or modal rather than blocking browser prompts.

### Scope
- refactor `useServiceWorkerUpdate.ts` to expose state rather than prompting directly
- add in-app UI with actions such as Reload now / Later
- preserve the existing safe reload semantics

### Likely files
- `packages/frontend/src/hooks/useServiceWorkerUpdate.ts`
- `packages/frontend/src/components/Layout.tsx`
- new update banner/component
- existing hook tests

### Acceptance criteria
- update availability is visible without a blocking confirm dialog
- reload action still activates the new worker correctly
- no regression to documented service worker behavior

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual SW update test in browser/PWA

### Docs
- update `docs/integration/pwa.md`
- update `docs/operations/runbooks.md`

### Risks
- update flows are easy to break subtly if message sequencing changes

---

## Slice 5.2 — Online/offline status indicator

### Outcome
Explain connectivity state in the installed app.

### Scope
- detect online/offline status at app level
- show a compact banner/badge when offline
- clarify that API-backed features require connectivity

### Likely files
- `packages/frontend/src/components/Layout.tsx`
- new connectivity hook/component
- maybe `packages/frontend/src/lib/api.ts` error handling touchpoints

### Acceptance criteria
- offline state is visible quickly after disconnect
- reconnect hides or resolves the warning cleanly

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual browser offline-mode test

### Docs
- update `docs/integration/pwa.md` if behavior becomes user-facing and important

### Risks
- “offline” messaging can overpromise if the app still requires network for most meaningful actions

---

## Slice 5.3 — Reconnect and refresh UX

### Outcome
Make temporary network recovery feel automatic and trustworthy.

### Scope
- refresh timer/summary/entries after reconnect
- distinguish stale data from active loading and true disconnect
- add light reconnect feedback if helpful

### Likely files
- query hooks
- layout/app-level connectivity state
- possibly `packages/frontend/src/lib/api.ts`

### Acceptance criteria
- reconnect updates visible stale surfaces without requiring manual refresh
- repeated network flaps do not create noisy UI

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual reconnect testing

### Docs
- likely covered by the same PWA/runbook updates

### Risks
- reconnect invalidation can become too aggressive and create churn

---

## Slice 5.4 — Settings app-status section

### Outcome
Give users a stable place to inspect app state.

### Scope
- show current version
- show update availability or up-to-date state
- optionally show last refresh/last successful sync language
- keep this lightweight and support-oriented

### Likely files
- settings page/components
- info hooks and SW update state plumbing

### Acceptance criteria
- app status is visible from Settings without feeling like a developer tool panel
- values remain accurate after updates/reloads

### Validation
- `yarn workspace @time-keeper/frontend test`
- manual settings pass

### Docs
- update `README.md`
- update `docs/integration/pwa.md`

### Risks
- support/status UI can confuse users if it exposes too much low-level detail

---

## Slice 5.5 — Doc and troubleshooting alignment

### Outcome
Keep runtime behavior and support docs aligned.

### Scope
- update PWA install/update docs
- update runbooks for new update UX and connectivity messaging
- ensure no stale instructions remain after the UI changes

### Likely files
- `docs/integration/pwa.md`
- `docs/operations/runbooks.md`
- `README.md` if feature summary changes

### Acceptance criteria
- docs match the observed update and connectivity behavior
- support instructions no longer reference outdated prompts or flows

### Validation
- manual doc review against behavior

### Docs
- this slice is documentation by definition

### Risks
- docs can lag if treated as optional cleanup rather than part of the slice

## Recommended first pickup for Epic 5
- Slice 5.1 + Slice 5.2

## Epic 5 exit criteria
- Installed PWA behavior feels reliable, legible, and supportable

---

# Cross-epic rules

## When to expand verification
Expand beyond the frontend test suite when a slice changes any of the following:
- backend route behavior
- API payload shape
- persistence schema
- shared business logic
- service worker semantics

## Documentation triggers
- **Visible feature or workflow changes** → update `README.md`
- **API surface, auth, storage, dependencies** → update `SECURITY.md`
- **Route map or architecture memory changes** → update `docs/memory/INDEX.md`
- **PWA behavior changes** → update `docs/integration/pwa.md` and `docs/operations/runbooks.md`
- **Visible UI changes** → suggest refreshing screenshots in `docs/screenshots/`

## Suggested implementation cadence
- Epic 1: 1.1 + 1.2, then 1.3, then 1.4, then 1.5 if still needed
- Epic 2: 2.1 + 2.2, then 2.3, then 2.4 + 2.5
- Epic 3: 3.1, then 3.2 + 3.3, then 3.4, then 3.5
- Epic 4: 4.1 + 4.2, then 4.3, then 4.4 + 4.5
- Epic 5: 5.1 + 5.2, then 5.3, then 5.4 + 5.5

## Best first slice overall
Start implementation with **Epic 1, Slices 1.1 and 1.2**:
- highest user impact
- likely frontend-only
- low architectural risk
- easy to verify
- no expected auth/storage/API changes
