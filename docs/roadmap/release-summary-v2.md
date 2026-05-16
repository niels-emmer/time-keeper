# Time Keeper v2 Release Summary

This summary captures the work delivered across Epics 1–5 and is intended as the operator-facing checklist for testing the `v2` branch on the VPS.

## Scope delivered

### Epic 1 — Track screen speed and focus
- Stronger active timer prominence on the Track screen
- Category search/filter by name and Workday code
- Recent categories section
- Track sort modes: manual, recent, A–Z
- Pinned categories with local persistence

### Epic 2 — Weekly handoff and export workflow
- Review-before-submit panel on the Weekly tab
- Export format picker
- Live export preview
- Copy-to-clipboard workflow with feedback
- Download support for CSV/plain/compact outputs
- Last-used export format persistence

### Epic 3 — Daily log and entry history
- Day log entry points from Weekly day headers
- Read-only day-level entry history
- Edit/delete completed entries
- Manual/backfilled entry creation
- Date navigation inside the day log
- Clear distinction between total editing and actual-entry editing

### Epic 4 — Monthly actionable planning
- Canonical monthly summary API payload
- Month navigation
- Monthly headline metrics
- Status chips per category
- Pace/projection guidance
- Focus/attention panel for categories that need action
- Existing monthly goal editing moved onto the canonical monthly summary flow

### Epic 5 — PWA update and connectivity polish
- In-app update banner instead of blocking `confirm()` dialogs
- Reload-now / later flow for service worker updates
- Offline banner
- Reconnect banner with query refresh behavior
- Settings → About now surfaces app-status information

## New and changed API surface

### Added
- `GET /api/summary/monthly`
- `POST /api/entries`

### Strengthened
- `PATCH /api/entries/:id` now validates reassigned category ownership and invalid time ranges

## Verification completed

### Shared
- `yarn workspace @time-keeper/shared build`

### Frontend
- `yarn workspace @time-keeper/frontend test`
- `yarn workspace @time-keeper/frontend build`

### Backend
- `yarn workspace @time-keeper/backend test`
- `yarn workspace @time-keeper/backend build`

At the end of the implementation cycle:
- frontend tests passed: **11 files / 40 tests**
- backend tests passed: **16 files / 110 tests**
- shared build passed
- frontend build passed
- backend build passed

## Changed files by area

### Docs and release planning
- `README.md`
- `SECURITY.md`
- `docs/integration/pwa.md`
- `docs/memory/INDEX.md`
- `docs/operations/runbooks.md`
- `docs/roadmap/epic-backlog.md`
- `docs/roadmap/release-summary-v2.md`

### Shared types
- `packages/shared/src/types/entry.ts`
- `packages/shared/src/types/summary.ts`

### Backend
- `packages/backend/src/routes/entries.ts`
- `packages/backend/src/routes/summary.ts`
- `packages/backend/src/services/summaryService.ts`
- `packages/backend/src/utils/entryValidation.ts`
- `packages/backend/src/routes/entries.test.ts`
- `packages/backend/src/services/summaryService.test.ts`

### Frontend — app shell and global state
- `packages/frontend/src/main.tsx`
- `packages/frontend/src/components/Layout.tsx`
- `packages/frontend/src/components/AboutSection.tsx`
- `packages/frontend/src/hooks/useServiceWorkerUpdate.ts`
- `packages/frontend/src/hooks/useOnlineStatus.ts`
- `packages/frontend/src/lib/appStatusContext.tsx`

### Frontend — Track / Weekly / Daily log / Monthly
- `packages/frontend/src/pages/Home.tsx`
- `packages/frontend/src/pages/Monthly.tsx`
- `packages/frontend/src/components/ActiveTimer.tsx`
- `packages/frontend/src/components/CategoryGrid.tsx`
- `packages/frontend/src/components/WeeklySummary.tsx`
- `packages/frontend/src/components/DailyLogDialog.tsx`
- `packages/frontend/src/components/MonthlyOverviewCard.tsx`
- `packages/frontend/src/components/MonthlyGoalsCard.tsx`
- `packages/frontend/src/components/MonthlyFocusCard.tsx`
- `packages/frontend/src/hooks/useTimer.ts`
- `packages/frontend/src/hooks/useEntries.ts`
- `packages/frontend/src/hooks/useMonthlySummary.ts`
- `packages/frontend/src/hooks/useRecentCategories.ts`
- `packages/frontend/src/lib/api.ts`
- `packages/frontend/src/lib/monthly.ts`
- `packages/frontend/src/lib/track.ts`
- `packages/frontend/src/lib/weeklyExport.ts`

### Frontend tests
- `packages/frontend/src/components/__tests__/CategoryGrid.test.tsx`
- `packages/frontend/src/components/__tests__/DailyLogDialog.test.tsx`
- `packages/frontend/src/components/__tests__/MonthlyFocusCard.test.tsx`
- `packages/frontend/src/components/__tests__/MonthlyGoalsCard.test.tsx`
- `packages/frontend/src/components/__tests__/MonthlyOverviewCard.test.tsx`
- `packages/frontend/src/components/__tests__/WeeklySummary.test.tsx`
- `packages/frontend/src/hooks/__tests__/useServiceWorkerUpdate.test.tsx`
- `packages/frontend/src/lib/__tests__/track.test.ts`
- `packages/frontend/src/lib/__tests__/weeklyExport.test.ts`

## VPS test checklist

1. Pull the `v2` branch on the VPS.
2. Rebuild and restart the stack.
3. Verify browser auth still works through Authentik/NPM.
4. Verify Track:
   - search
   - recents
   - pins
   - sort modes
5. Verify Weekly:
   - review panel
   - copy and download outputs
   - day-log access from day headers
6. Verify Daily log:
   - inspect entries
   - edit/delete completed entries
   - add manual entry
7. Verify Monthly:
   - month navigation
   - focus panel
   - pace/projection numbers
   - monthly goal editing
8. Verify PWA:
   - offline banner
   - reconnect banner
   - update banner / reload flow
   - Settings → About app-status rows

## Screenshot refresh recommended before release

Visible UI changed enough that these screenshots should be regenerated:
- `docs/screenshots/track.png`
- `docs/screenshots/weekly.png`
- `docs/screenshots/monthly.png`
- `docs/screenshots/settings.png`

## Important invariants preserved
- Authentik + NPM forward-auth remains the browser/PWA auth boundary
- one active timer per user
- SQLite remains the only persistent application state
- UTC ISO 8601 timestamps remain the storage format
