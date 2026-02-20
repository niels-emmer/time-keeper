/**
 * Settings service tests.
 *
 * Uses an in-memory SQLite database (better-sqlite3 ':memory:') with the
 * schema created inline so there is no dependency on the migration files or
 * on the DATABASE_PATH env variable.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

// ── Inline schema (mirrors packages/backend/src/db/schema.ts) ───────────────

const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').primaryKey(),
  weeklyGoalHours: integer('weekly_goal_hours').notNull().default(40),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ── Validation schema (mirrors the PUT route) ────────────────────────────────

const updateSchema = z.object({
  weeklyGoalHours: z.number().int().min(0).max(40),
});

// ── Test DB factory ──────────────────────────────────────────────────────────

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      weekly_goal_hours INTEGER NOT NULL DEFAULT 40,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return drizzle(sqlite, { schema: { userSettings } });
}

// ── Helper: get or create settings (mirrors route logic) ─────────────────────

function getOrCreate(db: ReturnType<typeof makeDb>, userId: string) {
  let row = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
  if (!row) {
    row = db.insert(userSettings).values({ userId, weeklyGoalHours: 40 }).returning().get()!;
  }
  return row;
}

function upsertGoal(db: ReturnType<typeof makeDb>, userId: string, weeklyGoalHours: number) {
  const now = new Date().toISOString();
  db.insert(userSettings)
    .values({ userId, weeklyGoalHours, updatedAt: now })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { weeklyGoalHours, updatedAt: now },
    })
    .run();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('settings service — getOrCreate', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  it('creates a row with the default 40 h goal when no row exists', () => {
    const settings = getOrCreate(db, 'alice@example.com');
    expect(settings.weeklyGoalHours).toBe(40);
    expect(settings.userId).toBe('alice@example.com');
  });

  it('returns the existing row without creating a duplicate', () => {
    getOrCreate(db, 'alice@example.com');
    const second = getOrCreate(db, 'alice@example.com');
    expect(second.weeklyGoalHours).toBe(40);

    const count = db.select().from(userSettings).all().length;
    expect(count).toBe(1);
  });

  it('isolates settings per user', () => {
    getOrCreate(db, 'alice@example.com');
    getOrCreate(db, 'bob@example.com');
    const all = db.select().from(userSettings).all();
    expect(all).toHaveLength(2);
  });
});

describe('settings service — upsertGoal', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  it('inserts a new row with the given goal', () => {
    upsertGoal(db, 'alice@example.com', 32);
    const row = db.select().from(userSettings).where(eq(userSettings.userId, 'alice@example.com')).get();
    expect(row?.weeklyGoalHours).toBe(32);
  });

  it('updates an existing row on conflict', () => {
    upsertGoal(db, 'alice@example.com', 40);
    upsertGoal(db, 'alice@example.com', 20);
    const row = db.select().from(userSettings).where(eq(userSettings.userId, 'alice@example.com')).get();
    expect(row?.weeklyGoalHours).toBe(20);
  });

  it('stores 0 as a valid goal', () => {
    upsertGoal(db, 'alice@example.com', 0);
    const row = db.select().from(userSettings).where(eq(userSettings.userId, 'alice@example.com')).get();
    expect(row?.weeklyGoalHours).toBe(0);
  });
});

describe('settings PUT validation schema', () => {
  it('accepts integer values 0–40', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: 0 })).not.toThrow();
    expect(() => updateSchema.parse({ weeklyGoalHours: 20 })).not.toThrow();
    expect(() => updateSchema.parse({ weeklyGoalHours: 40 })).not.toThrow();
  });

  it('rejects values above 40', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: 41 })).toThrow();
  });

  it('rejects values below 0', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: -1 })).toThrow();
  });

  it('rejects non-integer values', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: 37.5 })).toThrow();
  });

  it('rejects non-numeric values', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: '40' })).toThrow();
    expect(() => updateSchema.parse({ weeklyGoalHours: null })).toThrow();
  });
});
