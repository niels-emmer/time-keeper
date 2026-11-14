# Migrating an existing database to Phase A (D7)

Phase A introduces a `users` table and rewrites five `user_id` columns from the
Authentik email string to `users.id` (a UUID). It is the one migration in the
accounts plan that can silently mis-attribute real work, so it is applied by a
documented procedure with a proven backup, not by "it looked fine on dev".

- Design: `docs/design/auth-accounts.md` §4 and §9
- Migration: `packages/backend/drizzle/0011_amusing_blue_marvel.sql`
- Applier: `migrateWithRebuildSafety()` in
  `packages/backend/src/db/migrationRunner.ts`, called by `runMigrations()` at boot
- Automated proof: `packages/backend/src/db/migration.phaseA.test.ts`
- Evidence script: `packages/backend/scripts/verify-phase-a-migration.ts`

## What the migration does

1. Creates `users`, `sessions`, `recovery_codes`, `invites`, `auth_events`.
2. Backfills one `users` row per distinct email across `categories`,
   `time_entries`, `user_settings`, `api_tokens` and `monthly_project_goals`:
   - `email` — lower-cased and trimmed;
   - `username` — derived from the local part, `[a-z0-9_-]`, 3–32 characters,
     reserved names avoided, `-N` suffix on collision;
   - `password_hash` — an `unusable$…` sentinel, not a password (Q3);
   - `must_set_password = 1`, `role = 'user'`.
3. Rebuilds the five tables so `user_id` is a foreign key to `users.id`, mapping
   each row with `(SELECT id FROM users WHERE email = lower(trim(user_id)))`.
   A row that cannot be mapped yields `NULL` into a `NOT NULL` column and
   **aborts the migration** instead of detaching data.
4. Keeps the legacy `monthly_project_goals` table (Q24) and remaps existing
   `api_tokens` so the macOS app keeps working (Q25).
5. Remaps nothing else: no row is deleted and no id is renumbered.

`ADMIN_EMAIL` is *not* read by the SQL — promotion to `role='admin'` happens at
boot (`ensureAdminFromEmail()`), and in production a missing or unmatched
`ADMIN_EMAIL` stops the process (Q18).

## Before you start

```bash
DATABASE_PATH=/data/time-keeper.db      # or the path you are migrating
ADMIN_EMAIL=you@example.com             # must match one of the existing emails
SESSION_SECRET=$(openssl rand -base64 48)
MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

`ADMIN_EMAIL` must be an email that already exists in the data. Confirm it with:

```sql
SELECT DISTINCT user_id FROM categories
UNION SELECT DISTINCT user_id FROM time_entries
UNION SELECT DISTINCT user_id FROM user_settings
UNION SELECT DISTINCT user_id FROM api_tokens
UNION SELECT DISTINCT user_id FROM monthly_project_goals
ORDER BY 1;
```

## 1. Take a WAL-safe backup

The database runs in WAL mode, so copying the `.db` file alone can miss commits
still in the `-wal` file. Use one of:

```bash
# Preferred: a consistent, self-contained copy that includes the WAL.
sqlite3 "$DATABASE_PATH" "VACUUM INTO '/backups/time-keeper-pre-phase-a.db'"

# Or the online-backup API.
sqlite3 "$DATABASE_PATH" ".backup '/backups/time-keeper-pre-phase-a.db'"
```

Verify the backup opens and answers a question before trusting it:

```bash
sqlite3 /backups/time-keeper-pre-phase-a.db \
  "SELECT COUNT(*) FROM time_entries; PRAGMA integrity_check;"
```

Keep the backup until a week of real use has passed.

## 2. Dry-run on a copy

Never rehearse on the live file. Copy the backup and migrate the copy:

```bash
cp /backups/time-keeper-pre-phase-a.db /tmp/rehearsal.db
DATABASE_PATH=/tmp/rehearsal.db yarn workspace @time-keeper/backend db:migrate
```

`db:migrate` runs `runMigrations()`, which applies the foreign-key handling the
table rebuilds require. Do not apply the SQL with a bare `drizzle-kit migrate`
or `sqlite3 < file.sql`: without enforcement switched off around the batch, the
`COMMIT` fails on the `categories` rebuild.

To generate the full evidence report — row counts, per-user totals, usernames,
token remap, FK check — run the script. It builds a seeded legacy database,
takes a backup, migrates a copy and prints before/after tables:

```bash
yarn workspace @time-keeper/backend verify:migration
```

## 3. What must be identical after the rehearsal

```sql
-- Row counts: identical before and after.
SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'time_entries', COUNT(*) FROM time_entries
UNION ALL SELECT 'user_settings', COUNT(*) FROM user_settings
UNION ALL SELECT 'api_tokens', COUNT(*) FROM api_tokens
UNION ALL SELECT 'monthly_project_goals', COUNT(*) FROM monthly_project_goals;

-- Per-user totals, after the migration: one row per person, same minutes as
-- they had before under their email.
SELECT u.email,
       COUNT(DISTINCT c.id)                     AS categories,
       COUNT(t.id)                              AS entries,
       COALESCE(SUM(
         CAST(ROUND((julianday(t.end_time) - julianday(t.start_time)) * 1440) AS INTEGER)
       ), 0)                                     AS minutes
FROM users u
LEFT JOIN categories  c ON c.user_id = u.id
LEFT JOIN time_entries t ON t.user_id = u.id AND t.end_time IS NOT NULL
GROUP BY u.email
ORDER BY u.email;

-- No orphans.
PRAGMA foreign_key_check;

-- Every token still points at a real account.
SELECT u.email, t.label FROM api_tokens t JOIN users u ON u.id = t.user_id;
```

## 4. Apply to production

With the rehearsal clean:

1. Stop the container so no writes race the migration:
   `docker compose stop backend`
2. Take a fresh WAL-safe backup of the live file (repeat step 1).
3. Start the container. `runMigrations()` applies `0011` on boot, then the
   boot sequence promotes `ADMIN_EMAIL` to `role='admin'`.
4. Watch the logs. Boot fails — deliberately — if `ADMIN_EMAIL`,
   `SESSION_SECRET` or `MFA_ENCRYPTION_KEY` is missing in production.

## 5. Confirm the result

```bash
# Every existing person still resolves through the proxy path.
curl -s -H "X-authentik-email: you@example.com" \
     -H "X-Internal-Token: $INTERNAL_PROXY_SECRET" \
     http://backend:3001/api/info

# Their work is still theirs.
curl -s -H "X-authentik-email: you@example.com" \
     -H "X-Internal-Token: $INTERNAL_PROXY_SECRET" \
     "http://backend:3001/api/summary/weekly?week=2026-W15"
```

Then run the queries from step 3 against the live database. Every account
created by the migration has `must_set_password = 1` and an unusable password
hash; none of them has a password to reset, and none of them is a security
regression, because the proxy path is still the only way in until Phase B.

## 6. Rollback

The migration is forward-only. To go back:

1. `docker compose stop backend`
2. Remove the database **and its sidecar files**, then restore the backup:
   ```bash
   rm -f /data/time-keeper.db /data/time-keeper.db-wal /data/time-keeper.db-shm
   cp /backups/time-keeper-pre-phase-a.db /data/time-keeper.db
   ```
3. Deploy the previous image (`git checkout` the previous release tag and
   `docker compose up -d --build`).

Restoring the file without deleting the stale `-wal`/`-shm` sidecars is the
usual way this goes wrong: SQLite will happily replay a WAL that belongs to a
different database file.

## Risks, stated plainly

- **Wrong attribution** is the critical failure. It is mitigated by the
  mapping-or-abort rule, the row-count and per-user-total comparison, and the
  backup. If the dry run shows any difference, stop: a silently wrong migration
  is worse than a delayed phase.
- **Username derivation is a guess** at what people will want. It is
  deterministic and policy-compliant, but it is not their choice; usernames are
  immutable (Q14), so an unwanted one needs an admin rename path that Phase E
  owns.
- **Everyone starts with `must_set_password = 1`** and no password. Until an
  admin issues reset codes (Phase E), migrated accounts can only be used through
  the proxy path.
