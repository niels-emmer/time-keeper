/**
 * A1 / D7 — the email -> `users.id` migration, proven on a seeded copy.
 *
 * This is the test that backs the Phase A gate ("a seeded copy of a real
 * database migrates and every entry is still attributable to the right user").
 * It builds a pre-Phase-A database at migration 0010, takes a WAL-safe copy,
 * migrates the copy with the real Drizzle migrator, and then asserts that:
 *
 *   - every table has the same row count before and after;
 *   - every person has the same categories, entries, minutes, settings, tokens
 *     and monthly goals as before — attributed through `users.id` instead of
 *     their email;
 *   - the five `user_id` columns now reference `users.id` with no orphans;
 *   - existing API tokens still authenticate (Q25);
 *   - the legacy `monthly_project_goals` table still exists (Q24);
 *   - a pre-existing entry is still readable through the proxy auth path.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_TOKENS,
  createLegacySeededDatabase,
  foreignKeyViolations,
  indexNames,
  migrateToHead,
  snapshotLegacy,
  snapshotMigrated,
  tableCounts,
  vacuumInto,
} from '../test/phaseAFixture.js';

const RESERVED = ['admin', 'api', 'me', 'root', 'system'];

let workDir: string;
let legacyPath: string;
let backupPath: string;
let migratedPath: string;

interface Counts {
  [table: string]: number;
}

let beforeCounts: Counts;
let beforeOwnership: ReturnType<typeof snapshotLegacy>;

function normalizeKeys(snapshot: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(snapshot).map(([key, value]) => [key.trim().toLowerCase(), value])
  );
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-phase-a-migration-'));
  legacyPath = path.join(workDir, 'time-keeper-legacy.db');
  backupPath = path.join(workDir, 'time-keeper-backup.db');
  migratedPath = path.join(workDir, 'time-keeper-migrated.db');
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('Phase A migration (D7)', () => {
  it('starts from a database at migration 0010 with legacy email owners', () => {
    createLegacySeededDatabase(legacyPath);

    const ownership = snapshotLegacy(legacyPath);
    expect(Object.keys(ownership).sort()).toEqual([
      'Carol.Ops+work@Example.com',
      'a+b@example.com',
      'a.b@example.com',
      'admin@corp.com',
      'alice@example.com',
      'bob@example.com',
      'ro@example.com',
    ]);
    expect(ownership['alice@example.com']).toEqual({
      categories: 2,
      entries: 4,
      openEntries: 1,
      closedMinutes: 195,
      tokens: 1,
      goals: 1,
      settings: '40/60/Europe/Amsterdam',
    });

    beforeCounts = tableCounts(legacyPath);
    beforeOwnership = ownership;
  });

  it('takes a WAL-safe backup before touching anything', () => {
    vacuumInto(legacyPath, backupPath);

    expect(fs.existsSync(backupPath)).toBe(true);
    // The backup is a complete, self-contained database — it answers the same
    // questions as the original, including rows still in the WAL.
    expect(snapshotLegacy(backupPath)).toEqual(beforeOwnership);
  });

  it('migrates a copy and preserves every row count', () => {
    fs.copyFileSync(backupPath, migratedPath);
    migrateToHead(migratedPath);

    const after = tableCounts(migratedPath);

    for (const table of ['categories', 'time_entries', 'user_settings', 'api_tokens', 'monthly_project_goals']) {
      expect(after[table], `${table} row count`).toBe(beforeCounts[table]);
    }

    // New tables exist; only `users` is populated by the migration.
    expect(after.users).toBe(7);
    expect(after.sessions).toBe(0);
    expect(after.recovery_codes).toBe(0);
    expect(after.invites).toBe(0);
    expect(after.auth_events).toBe(0);

    // Q24: the legacy table is kept, not dropped.
    expect(after.monthly_project_goals).toBe(1);
  });

  it('attributes exactly the same data to exactly the same people', () => {
    const after = snapshotMigrated(migratedPath);

    expect(normalizeKeys(after)).toEqual(normalizeKeys(beforeOwnership));

    // Spot-check the two people with the most to lose.
    expect(after['alice@example.com']).toEqual(beforeOwnership['alice@example.com']);
    expect(after['bob@example.com']).toEqual(beforeOwnership['bob@example.com']);
  });

  it('creates one account per distinct email with a usable, de-collided username', () => {
    const after = snapshotMigrated(migratedPath);
    expect(Object.keys(after)).toHaveLength(7);

    // Carol's mixed-case, tagged email normalises to one account.
    expect(after['carol.ops+work@example.com']).toEqual(beforeOwnership['Carol.Ops+work@Example.com']);

    return import('better-sqlite3').then(({ default: Database }) => {
      const sqlite = new Database(migratedPath, { readonly: true });
      try {
        const rows = sqlite
          .prepare('SELECT email, username, role, password_hash, password_updated_at, must_set_password, disabled FROM users')
          .all() as Array<{
          email: string;
          username: string;
          role: string;
          password_hash: string;
          password_updated_at: string | null;
          must_set_password: number;
          disabled: number;
        }>;

        expect(rows).toHaveLength(7);

        for (const row of rows) {
          // Q14: 3-32 chars, [a-z0-9_-], never a reserved name.
          expect(row.username).toMatch(/^[a-z0-9_-]{3,32}$/);
          expect(RESERVED).not.toContain(row.username);
          // Q3: no password is generated or logged; the account is flagged.
          expect(row.password_hash).toMatch(/^unusable\$/);
          expect(row.password_updated_at).toBeNull();
          expect(row.must_set_password).toBe(1);
          expect(row.role).toBe('user');
          expect(row.disabled).toBe(0);
        }

        const usernames = rows.map((row) => row.username);
        expect(new Set(usernames).size).toBe(usernames.length);

        // Reserved local parts are de-collided instead of minted.
        const admin = rows.find((row) => row.email === 'admin@corp.com');
        expect(admin?.username).toBe('admin-1');

        // Two emails sanitising to the same slug stay distinct.
        const dotted = rows.find((row) => row.email === 'a.b@example.com');
        const plussed = rows.find((row) => row.email === 'a+b@example.com');
        expect(dotted?.username).not.toBe(plussed?.username);

        // Emails are stored lower-cased so proxy lookup is deterministic.
        expect(rows.every((row) => row.email === row.email.toLowerCase())).toBe(true);
      } finally {
        sqlite.close();
      }
    });
  });

  it('remaps API tokens onto users.id so the macOS app keeps working (Q25)', async () => {
    const { default: Database } = await import('better-sqlite3');
    const sqlite = new Database(migratedPath, { readonly: true });
    try {
      const tokens = sqlite
        .prepare('SELECT t.user_id AS userId, u.email AS email FROM api_tokens t JOIN users u ON u.id = t.user_id')
        .all() as Array<{ userId: string; email: string }>;

      expect(tokens).toHaveLength(LEGACY_TOKENS.length);
      expect(tokens.map((row) => row.email).sort()).toEqual([
        'alice@example.com',
        'ro@example.com',
      ]);
      // The old value was an email; the new one is a UUID.
      expect(tokens.every((row) => /^[0-9a-f-]{36}$/.test(row.userId))).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  it('leaves no foreign-key orphans and keeps the indexes', () => {
    expect(foreignKeyViolations(migratedPath)).toEqual([]);

    const indexes = indexNames(migratedPath);
    for (const expected of [
      'idx_users_email',
      'idx_users_username',
      'idx_categories_user_name',
      'idx_entries_user_start',
      'idx_entries_user_category',
      'idx_entries_one_open_per_user',
      'idx_api_tokens_hash',
      'idx_sessions_user',
    ]) {
      expect(indexes).toContain(expected);
    }

    // No half-finished rebuilds left behind.
    expect(indexes.filter((name) => name.startsWith('__new_'))).toEqual([]);
  });

  it('is a no-op when the migrator runs again at boot', () => {
    const before = tableCounts(migratedPath);
    migrateToHead(migratedPath);
    expect(tableCounts(migratedPath)).toEqual(before);
  });

  it('leaves the pre-migration backup untouched and restorable', () => {
    const backup = snapshotLegacy(backupPath);
    expect(normalizeKeys(backup)).toEqual(normalizeKeys(beforeOwnership));
  });
});

describe('migration runner', () => {
  it('restores foreign-key enforcement after the rebuild batch', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const { migrateWithRebuildSafety } = await import('./migrationRunner.js');
    const schema = await import('./schema.js');
    const { DRIZZLE_DIR } = await import('../test/phaseAFixture.js');

    const sqlite = new Database(':memory:');
    try {
      sqlite.pragma('foreign_keys = ON');
      migrateWithRebuildSafety(drizzle(sqlite, { schema }), sqlite, DRIZZLE_DIR);

      // If this stayed OFF, every ON DELETE CASCADE (D6) would silently stop
      // working for the life of the process.
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('leaves enforcement off when the connection started with it off', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const { migrateWithRebuildSafety } = await import('./migrationRunner.js');
    const schema = await import('./schema.js');
    const { DRIZZLE_DIR } = await import('../test/phaseAFixture.js');

    const sqlite = new Database(':memory:');
    try {
      sqlite.pragma('foreign_keys = OFF');
      migrateWithRebuildSafety(drizzle(sqlite, { schema }), sqlite, DRIZZLE_DIR);
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});

describe('post-migration proxy auth path', () => {
  let app: express.Express;

  beforeAll(async () => {
    // Boot the real app against the migrated database, exactly as production
    // would after the deploy.
    process.env.DATABASE_PATH = migratedPath;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_MODE = 'proxy';
    delete process.env.DEV_USER_ID;
    delete process.env.TRUSTED_PROXY_CIDRS;

    vi.resetModules();

    const { db, runMigrations } = await import('../db/client.js');
    const { createApp } = await import('../app.js');
    runMigrations(db);
    app = createApp();
  });

  const headers = {
    Host: 'phase-a.test',
    Origin: 'http://phase-a.test',
    'X-authentik-email': 'alice@example.com',
  };

  it('still identifies the pre-existing user by their email', async () => {
    const res = await request(app).get('/api/info').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.user).toBe('alice@example.com');
  });

  it('still returns the pre-existing entries for that user', async () => {
    const day = await request(app).get('/api/entries?date=2026-04-06').set(headers);

    expect(day.status).toBe(200);
    expect(day.body.map((entry: { startTime: string }) => entry.startTime).sort()).toEqual([
      '2026-04-06T09:00:00.000Z',
      '2026-04-06T13:00:00.000Z',
    ]);

    const week = await request(app).get('/api/summary/weekly?week=2026-W15').set(headers);
    expect(week.status).toBe(200);
    // 90 + 75 on Monday + 30 on Tuesday; the running timer is not counted.
    expect(week.body.totalMinutes).toBe(195);

    const categories = await request(app).get('/api/categories').set(headers);
    expect(categories.body.map((row: { name: string }) => row.name).sort()).toEqual([
      'Admin',
      'Work',
    ]);
  });

  it('keeps users isolated from each other after the remap', async () => {
    const res = await request(app)
      .get('/api/categories')
      .set({ ...headers, 'X-authentik-email': 'bob@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.map((row: { name: string }) => row.name)).toEqual(['Consulting']);
  });

  it('keeps a remapped API token working against its original owner’s data', async () => {
    const token = LEGACY_TOKENS.find((row) => row.email === 'alice@example.com')!.rawToken;

    const info = await request(app).get('/api/info').set('Authorization', `Bearer ${token}`);
    expect(info.status).toBe(200);
    expect(info.body.user).toBe('alice@example.com');

    const categories = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${token}`);
    expect(categories.status).toBe(200);
    expect(categories.body.map((row: { name: string }) => row.name).sort()).toEqual([
      'Admin',
      'Work',
    ]);
  });

  it('does not invent a new account for an existing email', async () => {
    const { default: Database } = await import('better-sqlite3');
    const sqlite = new Database(migratedPath, { readonly: true });
    try {
      const row = sqlite.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
      expect(row.n).toBe(7);
    } finally {
      sqlite.close();
    }
  });
});
