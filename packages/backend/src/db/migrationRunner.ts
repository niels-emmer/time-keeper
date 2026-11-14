import type Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { AppDatabase } from './client.js';

/**
 * Apply Drizzle migrations with the foreign-key handling SQLite's table-rebuild
 * procedure requires.
 *
 * Migration 0011 (Phase A / D7) rebuilds five tables to point `user_id` at
 * `users.id`. SQLite cannot add a foreign key to an existing table: the table
 * has to be recreated, and the recreate has to `DROP` a table that other tables
 * reference. Inside a transaction `PRAGMA foreign_keys = OFF` is a no-op, and
 * `PRAGMA defer_foreign_keys = ON` is not enough — the implicit delete that
 * `DROP TABLE` performs still leaves a deferred violation that fails the
 * `COMMIT` even though `foreign_key_check` afterwards reports a clean database.
 *
 * So enforcement is switched off around the whole batch, exactly as SQLite's
 * documented "making other kinds of table schema changes" procedure prescribes,
 * and every remaining constraint is validated with `foreign_key_check` before
 * enforcement is restored. A violation aborts the boot rather than leaving a
 * detached row behind.
 */
export function migrateWithRebuildSafety(
  database: AppDatabase,
  client: Database.Database,
  migrationsFolder: string
): void {
  const enforcementWasOn = client.pragma('foreign_keys', { simple: true }) === 1;

  if (enforcementWasOn) {
    client.pragma('foreign_keys = OFF');
  }

  try {
    migrate(database, { migrationsFolder });

    if (enforcementWasOn) {
      const violations = client.pragma('foreign_key_check') as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `Migrations left ${violations.length} foreign-key violation(s); refusing to continue. ` +
            `Inspect with: PRAGMA foreign_key_check; ${JSON.stringify(violations)}`
        );
      }
    }
  } finally {
    client.pragma(`foreign_keys = ${enforcementWasOn ? 'ON' : 'OFF'}`);
  }
}
