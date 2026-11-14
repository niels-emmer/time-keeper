# Runbooks — Time Keeper

Common break/fix procedures.

---

## RB-001: Timer stuck / can't start new timer

**Symptom:** The app shows no active timer but starting a new one fails with an error, or the home screen shows a category as "active" that isn't tracking.

**Cause:** A `time_entries` row with `end_time IS NULL` exists but the timer UI is out of sync.

> The runtime image does not ship the `sqlite3` CLI. Use the bundled `better-sqlite3` through `node` (the same database library the app uses).

**Fix:**

```bash
# Find the stuck entry
docker compose exec -T backend node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('/data/time-keeper.db');
console.table(db.prepare('SELECT id, user_id, category_id, start_time FROM time_entries WHERE end_time IS NULL').all());
db.close();
NODE

# Stop it manually (UTC ISO 8601, matching the app's storage format)
docker compose exec -T backend node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('/data/time-keeper.db');
const result = db.prepare("UPDATE time_entries SET end_time = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE end_time IS NULL").run();
console.log(`closed ${result.changes} open row(s)`);
db.close();
NODE
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

**Fix (user side):** The service worker uses `registerType: 'autoUpdate'`. When a new build is ready, the app now shows a **New version available** banner. Tap **Reload now** to activate the waiting worker and refresh into the new version.

**Fix (force):**
- Android Chrome: Open app → three-dot menu → "Clear data" → re-install
- macOS Chrome: Navigate to `chrome://serviceworker-internals`, find the app's worker, click "Unregister", then reload
- macOS Safari: **Cmd+Shift+R** for a hard refresh; or Develop menu → Empty Caches, then reload. Enable the Develop menu via Settings → Advanced → "Show features for web developers"

**Fix (developer — prevent this):** Ensure the `vite build` output has content-hashed filenames (default behavior). If filenames are not changing, the service worker won't detect updates. Also confirm the update banner still appears and that `Reload now` triggers `SKIP_WAITING` followed by a page reload.

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

docker compose run --rm --entrypoint node backend - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('/data/time-keeper.db', { readonly: true });
console.log('integrity_check:', db.pragma('integrity_check', { simple: true }));
db.close();
NODE

docker compose start backend
# Restore from backup if corrupted — see RB-007
```

---

## RB-006: WAL-safe backup

**Finding M-5.** The database runs with `journal_mode = WAL`. Recent commits live in `time-keeper.db-wal` until a checkpoint, so copying only `time-keeper.db` while the backend runs can produce a backup that silently misses the newest entries — the worst failure mode for a time tracker.

Do **one** of the following. Never copy the `.db` file alone while the backend is running.

### Online snapshot (preferred, no downtime)

`better-sqlite3` is the app's own SQLite driver, so the runtime image always has a WAL-safe `.backup` API. It is the equivalent of `sqlite3 ... ".backup ..."`; the image does not ship the `sqlite3` CLI.

```bash
cd /opt/time-keeper   # the compose project directory
mkdir -p backups

docker compose exec -T backend node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('/data/time-keeper.db');
db.backup('/data/backup.db')
  .then(() => { db.close(); console.log('WAL-safe snapshot written to /data/backup.db'); })
  .catch((error) => { console.error(error); process.exit(1); });
NODE

docker compose cp backend:/data/backup.db "backups/time-keeper-$(date +%Y%m%dT%H%M%S).db"
docker compose exec backend rm /data/backup.db
```

Daily cron job (single line because cron has no heredoc; `-T` disables the TTY):

```cron
0 2 * * * cd /opt/time-keeper && docker compose exec -T backend node -e "const D=require('better-sqlite3');const db=new D('/data/time-keeper.db');db.backup('/data/backup.db').then(()=>db.close()).catch((e)=>{console.error(e);process.exit(1);})" && docker compose cp backend:/data/backup.db backups/time-keeper-$(date +\%Y\%m\%d).db && docker compose exec -T backend rm -f /data/backup.db
```

### Offline copy (accepts downtime)

A clean stop checkpoints the WAL into the main file, so the single `.db` is complete:

```bash
docker compose stop backend
docker compose cp backend:/data/time-keeper.db "backups/time-keeper-$(date +%Y%m%d).db"
docker compose start backend
```

### Verify a backup before trusting it

```bash
docker compose run --rm --entrypoint node -v "$PWD/backups:/backups:ro" backend - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('/backups/time-keeper-YYYYMMDD.db', { readonly: true });
console.log('integrity_check:', db.pragma('integrity_check', { simple: true }));
console.log('entries:', db.prepare('SELECT COUNT(*) AS n FROM time_entries').get().n);
db.close();
NODE
```

`integrity_check` must print `ok`, and the entry count should be plausible for the day.

---

## RB-007: Restore drill

Run this against a **scratch** compose project or a copy of the volume first; repeat it monthly so the backup is known-good rather than assumed-good.

```bash
cd /opt/time-keeper
BACKUP=./backups/time-keeper-YYYYMMDD.db

# 1. Stop the app so no writes race the restore.
docker compose stop backend

# 2. Replace the database file inside the volume.
docker compose cp "$BACKUP" backend:/data/time-keeper.db

# 3. Remove stale WAL/SHM side files from the database being replaced.
#    If they survive, SQLite can replay them over the restored file.
docker compose run --rm --entrypoint sh backend -c 'rm -f /data/time-keeper.db-wal /data/time-keeper.db-shm'

# 4. Start and verify.
docker compose start backend
docker compose exec -T backend node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('/data/time-keeper.db', { readonly: true });
console.log('integrity_check:', db.pragma('integrity_check', { simple: true }));
console.log('entries:', db.prepare('SELECT COUNT(*) AS n FROM time_entries').get().n);
console.log('categories:', db.prepare('SELECT COUNT(*) AS n FROM categories').get().n);
console.log('settings:', db.prepare('SELECT COUNT(*) AS n FROM user_settings').get().n);
db.close();
NODE
```

Then open the app and spot-check: the current week's entries, the weekly total, and Settings → Work week. The restored database must contain nothing newer than the backup timestamp.

> **Drill checklist:** take a fresh online snapshot, restore it into a scratch volume, run the verification block, and confirm the counts match the source. Record the date and result in the deployment log.
