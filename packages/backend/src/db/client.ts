import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';
import * as schema from './schema.js';
import { migrateWithRebuildSafety } from './migrationRunner.js';

/**
 * Open a SQLite database at `databasePath` and wrap it in a Drizzle client.
 *
 * Pass `':memory:'` for an ephemeral database — that is what the test harness
 * in `src/test/harness.ts` uses. Production keeps using the module-level `db`
 * below, which is created from `DATABASE_PATH` exactly as before.
 */
export function createDb(databasePath: string) {
  // An in-memory database has no parent directory to create.
  if (databasePath !== ':memory:') {
    const dbDir = path.dirname(databasePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  const sqlite = new Database(databasePath);

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  return drizzle(sqlite, { schema });
}

export type AppDatabase = ReturnType<typeof createDb>;

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'dev-data', 'time-keeper.db');

export const db = createDb(DB_PATH);

/**
 * Run Drizzle migrations from the ./drizzle directory.
 * Called once at server startup; tests pass their own database.
 *
 * Foreign-key enforcement is toggled around the batch by
 * `migrateWithRebuildSafety` — migration 0011 rebuilds tables, which SQLite
 * cannot do with enforcement on. The helper re-validates with
 * `PRAGMA foreign_key_check` before restoring it.
 */
export function runMigrations(database: AppDatabase = db): void {
  const migrationsFolder = path.join(import.meta.dirname, '..', '..', 'drizzle');
  migrateWithRebuildSafety(database, database.$client, migrationsFolder);
  console.log('Database migrations applied.');
}
