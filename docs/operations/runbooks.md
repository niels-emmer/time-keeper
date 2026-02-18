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

## RB-003: oauth2-proxy redirect loop

**Symptom:** Browser keeps redirecting through the Authentik login page without stopping.

**Cause:** Usually a mismatch between `APP_URL` in `.env` and the redirect URI registered in Authentik.

**Fix:**
1. In `.env`, verify `APP_URL` matches the redirect URI in Authentik exactly (protocol, hostname, no trailing slash).
2. In Authentik, verify the redirect URI is `${APP_URL}/oauth2/callback`.
3. Regenerate `OAUTH2_COOKIE_SECRET` if the cookie is corrupted: `openssl rand -base64 32`.
4. Restart oauth2-proxy: `docker compose restart oauth2-proxy`.

---

## RB-004: PWA not showing updated version

**Symptom:** After deploying a new version, the app still shows old UI.

**Cause:** The service worker is serving a cached version.

**Fix (user side):** The service worker uses `registerType: 'autoUpdate'`. The update should apply on the next page navigation after the service worker detects it (typically within a few minutes of opening the app).

**Fix (force):**
- Android Chrome: Open app → three-dot menu → "Clear data" → re-install
- macOS: In Chrome, navigate to `chrome://serviceworker-internals`, find the app's worker, click "Unregister"

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
