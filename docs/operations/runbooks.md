# Runbooks — Time Keeper

Common break/fix procedures.

---

## RB-001: Timer stuck / can't start new timer

**Symptom:** The app shows no active timer but starting a new one fails with an error, or the home screen shows a category as "active" that isn't tracking.

**Cause:** A `time_entries` row with `end_time IS NULL` exists but the timer UI is out of sync.

**Fix:**

```bash
# Find the stuck entry
docker compose exec backend sqlite3 /data/time-keeper.db \
  "SELECT id, user_id, category_id, start_time FROM time_entries WHERE end_time IS NULL;"

# Stop it manually
docker compose exec backend sqlite3 /data/time-keeper.db \
  "UPDATE time_entries SET end_time = datetime('now') WHERE end_time IS NULL;"
```

Then refresh the app.

---

## RB-002: Database locked error

**Symptom:** Backend logs show `SQLITE_BUSY: database is locked`.

**Cause:** WAL mode is enabled but another process (e.g. a direct sqlite3 CLI session) has an open write transaction.

**Fix:** Exit any open sqlite3 CLI sessions. WAL mode allows concurrent reads but only one writer at a time. Do not run manual SQL writes while the backend is running in production.

---

## RB-003: Authentik redirect loop after login

**Symptom:** Browser keeps cycling through the Authentik login page without reaching the app.

**Cause:** Usually a mismatch between the Proxy Provider's **External host** and the domain NPM is serving.

**Fix:**
1. In Authentik Admin → Applications → Providers → `time-keeper`: verify **External host** matches the domain exactly, including `https://` and no trailing slash.
2. In NPM, verify the proxy host domain matches the External host above.
3. Confirm the outpost has been saved after adding the application (it reconfigures within seconds).
4. If the loop started after a domain change: update the External host in Authentik, save, and hard-refresh the browser to clear the Authentik session cookie.

---

## RB-004: PWA not showing updated version

**Symptom:** After deploying a new version, the app still shows old UI.

**Cause:** The service worker is serving a cached version.

**Fix (user side):** The service worker uses `registerType: 'autoUpdate'`. The update should apply on the next page navigation after the service worker detects it (typically within a few minutes of opening the app).

**Fix (force):**
- Android Chrome: Open app → three-dot menu → "Clear data" → re-install
- macOS Chrome: Navigate to `chrome://serviceworker-internals`, find the app's worker, click "Unregister", then reload
- macOS Safari: **Cmd+Shift+R** for a hard refresh; or Develop menu → Empty Caches, then reload. Enable the Develop menu via Settings → Advanced → "Show features for web developers"

**Fix (developer — prevent this):** Ensure the `vite build` output has content-hashed filenames (default behavior). If filenames are not changing, the service worker won't detect updates.

---

## RB-005: Backend not starting / migration failure

**Symptom:** Backend container exits immediately; logs show a migration error.

**Fix:**
```bash
docker compose logs backend

# If migration SQL is malformed, check the drizzle/ directory
ls packages/backend/drizzle/

# Force re-run migrations (they're idempotent via drizzle's journal)
docker compose restart backend
```

If the DB file is corrupted:
```bash
docker compose stop backend
docker compose exec backend sqlite3 /data/time-keeper.db "PRAGMA integrity_check;"
# Restore from backup if corrupted — see deployment.md#restore
```
