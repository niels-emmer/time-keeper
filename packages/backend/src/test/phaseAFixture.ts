import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { migrateWithRebuildSafety } from '../db/migrationRunner.js';

/**
 * Migration-safety fixture for Phase A / D7.
 *
 * Builds a database that looks like a real pre-Phase-A install (schema at
 * migration 0010, several Authentik-email owners, entries, settings, an API
 * token, a monthly goal), then snapshots what each person owns. The test and
 * `packages/backend/scripts/verify-phase-a-migration.ts` both build on this, so
 * the procedure in `docs/operations/migration-phase-a.md` and the assertion
 * suite cannot drift apart.
 *
 * The legacy rows are written with raw SQL on purpose: the Drizzle schema now
 * describes the post-migration shape (foreign keys to `users`), so it cannot be
 * used to create the data the migration is supposed to receive.
 */

export const DRIZZLE_DIR = path.join(import.meta.dirname, '..', '..', 'drizzle');
export const HEAD_MIGRATION_TAG = '0011_amusing_blue_marvel';

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export function readJournal(drizzleDir: string = DRIZZLE_DIR): JournalEntry[] {
  const raw = fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8');
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

/** Tags that exist before Phase A's migration. */
export function legacyTags(drizzleDir: string = DRIZZLE_DIR): JournalEntry[] {
  return readJournal(drizzleDir).filter((entry) => entry.tag !== HEAD_MIGRATION_TAG);
}

function readMigrationSql(tag: string, drizzleDir: string = DRIZZLE_DIR): string {
  return fs.readFileSync(path.join(drizzleDir, `${tag}.sql`), 'utf8');
}

/**
 * Create `databasePath` at migration 0010 and seed it with legacy data.
 *
 * The `__drizzle_migrations` marker is written by hand: that is what makes the
 * real migrator see exactly one pending migration (0011) on the next call,
 * reproducing an upgrade rather than a fresh install.
 */
export function createLegacySeededDatabase(databasePath: string): void {
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');

    const legacy = legacyTags();
    for (const entry of legacy) {
      sqlite.exec(readMigrationSql(entry.tag));
    }

    const lastLegacy = legacy[legacy.length - 1];
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    sqlite
      .prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
      .run('legacy-fixture', lastLegacy.when);

    seedLegacyRows(sqlite);
  } finally {
    sqlite.close();
  }
}

export interface LegacyUserSpec {
  /** The pre-migration identity: the Authentik email stored in `user_id`. */
  email: string;
}

/** The people in the fixture, and the raw token each token row represents. */
export const LEGACY_USERS: LegacyUserSpec[] = [
  { email: 'alice@example.com' },
  { email: 'bob@example.com' },
  { email: 'Carol.Ops+work@Example.com' },
  { email: 'admin@corp.com' },
  { email: 'a.b@example.com' },
  { email: 'a+b@example.com' },
  { email: 'ro@example.com' },
];

export const LEGACY_TOKENS: Array<{ email: string; rawToken: string; label: string }> = [
  { email: 'alice@example.com', rawToken: 'legacy-mac-token-for-alice', label: 'MacBook' },
  { email: 'ro@example.com', rawToken: 'legacy-readonly-token', label: 'readonly' },
];

function seedLegacyRows(sqlite: Database.Database): void {
  const insertCategory = sqlite.prepare(
    `INSERT INTO "categories" ("user_id", "name", "color", "billable", "sort_order")
     VALUES (?, ?, '#6366f1', ?, ?)`
  );
  const insertEntry = sqlite.prepare(
    `INSERT INTO "time_entries" ("user_id", "category_id", "start_time", "end_time", "notes", "rounded")
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertSettings = sqlite.prepare(
    `INSERT INTO "user_settings" ("user_id", "weekly_goal_hours", "rounding_increment_minutes", "timezone")
     VALUES (?, ?, ?, ?)`
  );
  const insertToken = sqlite.prepare(
    `INSERT INTO "api_tokens" ("user_id", "token_hash", "label", "expires_at")
     VALUES (?, ?, ?, '2999-01-01T00:00:00.000Z')`
  );
  const insertGoal = sqlite.prepare(
    `INSERT INTO "monthly_project_goals" ("user_id", "category_id", "month_year", "available_hours", "available_minutes")
     VALUES (?, ?, ?, ?, ?)`
  );

  // alice: two categories, three closed entries, one RUNNING timer, a goal.
  const aliceWork = Number(insertCategory.run('alice@example.com', 'Work', 1, 0).lastInsertRowid);
  const aliceAdmin = Number(insertCategory.run('alice@example.com', 'Admin', 0, 1).lastInsertRowid);
  insertEntry.run('alice@example.com', aliceWork, '2026-04-06T09:00:00.000Z', '2026-04-06T10:30:00.000Z', null, 0);
  insertEntry.run('alice@example.com', aliceWork, '2026-04-06T13:00:00.000Z', '2026-04-06T14:15:00.000Z', 'afternoon', 0);
  insertEntry.run('alice@example.com', aliceAdmin, '2026-04-07T09:30:00.000Z', '2026-04-07T10:00:00.000Z', null, 1);
  insertEntry.run('alice@example.com', aliceWork, '2026-04-07T15:00:00.000Z', null, null, 0);
  insertSettings.run('alice@example.com', 40, 60, 'Europe/Amsterdam');
  insertGoal.run('alice@example.com', aliceWork, '2026-04', 80, 4800);

  // bob: one category, one closed entry.
  const bobWork = Number(insertCategory.run('bob@example.com', 'Consulting', 1, 0).lastInsertRowid);
  insertEntry.run('bob@example.com', bobWork, '2026-04-06T08:00:00.000Z', '2026-04-06T09:00:00.000Z', null, 0);
  insertSettings.run('bob@example.com', 30, 30, 'UTC');

  // carol: mixed-case email with a '+' tag — must normalise, not duplicate.
  const carolWork = Number(insertCategory.run('Carol.Ops+work@Example.com', 'Ops', 1, 0).lastInsertRowid);
  insertEntry.run('Carol.Ops+work@Example.com', carolWork, '2026-04-07T11:00:00.000Z', '2026-04-07T12:30:00.000Z', null, 0);
  insertSettings.run('Carol.Ops+work@Example.com', 35, 30, 'Europe/London');

  // admin@corp.com: its local part is a reserved username, so the migration
  // must de-collide it rather than mint `admin`.
  const adminWork = Number(insertCategory.run('admin@corp.com', 'Admin work', 1, 0).lastInsertRowid);
  insertEntry.run('admin@corp.com', adminWork, '2026-04-07T13:00:00.000Z', '2026-04-07T13:45:00.000Z', null, 0);

  // Two emails whose local parts sanitise to the same slug (`a-b`).
  const dottedWork = Number(insertCategory.run('a.b@example.com', 'Dotted', 1, 0).lastInsertRowid);
  insertEntry.run('a.b@example.com', dottedWork, '2026-04-06T11:00:00.000Z', '2026-04-06T11:30:00.000Z', null, 0);

  const plussedWork = Number(insertCategory.run('a+b@example.com', 'Plussed', 1, 0).lastInsertRowid);
  insertEntry.run('a+b@example.com', plussedWork, '2026-04-06T12:00:00.000Z', '2026-04-06T12:30:00.000Z', null, 0);

  // ro@example.com owns only a token — proves the backfill's UNION covers
  // tables other than categories/entries.
  for (const token of LEGACY_TOKENS) {
    insertToken.run(token.email, createHash('sha256').update(token.rawToken).digest('hex'), token.label);
  }
}

export interface OwnedTotals {
  categories: number;
  entries: number;
  openEntries: number;
  closedMinutes: number;
  tokens: number;
  goals: number;
  settings: string | null;
}

export type Snapshot = Record<string, OwnedTotals>;

interface RawRow {
  owner: string;
}

/**
 * Snapshot what each person owns, keyed by identity.
 *
 * `legacy` reads the email out of the `user_id` column; `migrated` resolves
 * `users.id` back to the email with a join. Everything else is identical, which
 * is what makes the before/after comparison meaningful.
 */
function buildSnapshot(sqlite: Database.Database, mode: 'legacy' | 'migrated'): Snapshot {
  const owner = mode === 'legacy' ? 't.user_id' : 'u.email';
  const join = mode === 'legacy' ? '' : ' JOIN users u ON u.id = t.user_id';
  const from = (table: string, extraColumns = '') =>
    `SELECT ${owner} AS owner${extraColumns} FROM "${table}" t${join}`;

  const snapshot: Snapshot = {};
  const ensure = (key: string): OwnedTotals => {
    snapshot[key] ??= {
      categories: 0,
      entries: 0,
      openEntries: 0,
      closedMinutes: 0,
      tokens: 0,
      goals: 0,
      settings: null,
    };
    return snapshot[key];
  };

  for (const row of sqlite.prepare(from('categories')).all() as RawRow[]) {
    ensure(row.owner).categories += 1;
  }

  for (const row of sqlite
    .prepare(from('time_entries', ', t.start_time AS startTime, t.end_time AS endTime'))
    .all() as Array<RawRow & { startTime: string; endTime: string | null }>) {
    const totals = ensure(row.owner);
    totals.entries += 1;
    if (row.endTime === null) {
      totals.openEntries += 1;
    } else {
      totals.closedMinutes += Math.round(
        (Date.parse(row.endTime) - Date.parse(row.startTime)) / 60000
      );
    }
  }

  for (const row of sqlite.prepare(from('api_tokens')).all() as RawRow[]) {
    ensure(row.owner).tokens += 1;
  }

  for (const row of sqlite.prepare(from('monthly_project_goals')).all() as RawRow[]) {
    ensure(row.owner).goals += 1;
  }

  for (const row of sqlite
    .prepare(
      from(
        'user_settings',
        ', t.weekly_goal_hours AS hours, t.rounding_increment_minutes AS inc, t.timezone AS tz'
      )
    )
    .all() as Array<RawRow & { hours: number; inc: number; tz: string }>) {
    ensure(row.owner).settings = `${row.hours}/${row.inc}/${row.tz}`;
  }

  return snapshot;
}

/** What each pre-migration email owned, read from the legacy tables. */
export function snapshotLegacy(databasePath: string): Snapshot {
  const sqlite = new Database(databasePath, { readonly: true });
  try {
    return buildSnapshot(sqlite, 'legacy');
  } finally {
    sqlite.close();
  }
}

/** The same facts, read after the migration by resolving `users.id` -> email. */
export function snapshotMigrated(databasePath: string): Snapshot {
  const sqlite = new Database(databasePath, { readonly: true });
  try {
    return buildSnapshot(sqlite, 'migrated');
  } finally {
    sqlite.close();
  }
}

export function tableCounts(databasePath: string): Record<string, number> {
  const sqlite = new Database(databasePath, { readonly: true });
  try {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name")
      .all() as Array<{ name: string }>;

    const counts: Record<string, number> = {};
    for (const { name } of tables) {
      counts[name] = (sqlite.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
    }
    return counts;
  } finally {
    sqlite.close();
  }
}

/**
 * Run the real Drizzle migrator (the same call `runMigrations()` makes at
 * boot) over `databasePath`. Applies only 0011 when the fixture is in place.
 */
export function migrateToHead(databasePath: string, drizzleDir: string = DRIZZLE_DIR): void {
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    // Same call `runMigrations()` makes at boot, including the foreign-key
    // toggle the table rebuilds need.
    migrateWithRebuildSafety(drizzle(sqlite, { schema }), sqlite, drizzleDir);
  } finally {
    sqlite.close();
  }
}

/**
 * WAL-safe backup: `VACUUM INTO` writes a consistent copy of the database,
 * including everything currently in the write-ahead log, without needing the
 * writer to stop. This is the first step of the documented procedure.
 */
export function vacuumInto(sourcePath: string, destinationPath: string): void {
  fs.rmSync(destinationPath, { force: true });
  const sqlite = new Database(sourcePath);
  try {
    sqlite.prepare('VACUUM INTO ?').run(destinationPath);
  } finally {
    sqlite.close();
  }
}

export function foreignKeyViolations(databasePath: string): unknown[] {
  const sqlite = new Database(databasePath, { readonly: true });
  try {
    sqlite.pragma('foreign_keys = ON');
    return sqlite.pragma('foreign_key_check') as unknown[];
  } finally {
    sqlite.close();
  }
}

export function indexNames(databasePath: string): string[] {
  const sqlite = new Database(databasePath, { readonly: true });
  try {
    return (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
  } finally {
    sqlite.close();
  }
}
