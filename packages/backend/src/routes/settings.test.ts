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
  roundingIncrementMinutes: integer('rounding_increment_minutes').notNull().default(60),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ── Validation schema (mirrors the PUT route) ────────────────────────────────

const updateSchema = z.object({
  weeklyGoalHours: z.number().int().min(0).max(40),
  roundingIncrementMinutes: z.union([z.literal(30), z.literal(60)]),
});

// ── Test DB factory ──────────────────────────────────────────────────────────

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      weekly_goal_hours INTEGER NOT NULL DEFAULT 40,
      rounding_increment_minutes INTEGER NOT NULL DEFAULT 60,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return drizzle(sqlite, { schema: { userSettings } });
}

// ── Helper: get or create settings (mirrors route logic) ─────────────────────

function getOrCreate(db: ReturnType<typeof makeDb>, userId: string) {
  let row = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
  if (!row) {
    row = db
      .insert(userSettings)
      .values({ userId, weeklyGoalHours: 40, roundingIncrementMinutes: 60 })
      .returning()
      .get()!;
  }
  return row;
}

function upsertSettings(
  db: ReturnType<typeof makeDb>,
  userId: string,
  weeklyGoalHours: number,
  roundingIncrementMinutes: 30 | 60 = 60
) {
  const now = new Date().toISOString();
  db.insert(userSettings)
    .values({ userId, weeklyGoalHours, roundingIncrementMinutes, updatedAt: now })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { weeklyGoalHours, roundingIncrementMinutes, updatedAt: now },
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

  it('creates a row with the default 60-min rounding increment', () => {
    const settings = getOrCreate(db, 'alice@example.com');
    expect(settings.roundingIncrementMinutes).toBe(60);
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

describe('settings service — upsertSettings', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  it('inserts a new row with the given goal and increment', () => {
    upsertSettings(db, 'alice@example.com', 32, 30);
    const row = db.select().from(userSettings).where(eq(userSettings.userId, 'alice@example.com')).get();
    expect(row?.weeklyGoalHours).toBe(32);
    expect(row?.roundingIncrementMinutes).toBe(30);
  });

  it('updates an existing row on conflict', () => {
    upsertSettings(db, 'alice@example.com', 40, 60);
    upsertSettings(db, 'alice@example.com', 20, 30);
    const row = db.select().from(userSettings).where(eq(userSettings.userId, 'alice@example.com')).get();
    expect(row?.weeklyGoalHours).toBe(20);
    expect(row?.roundingIncrementMinutes).toBe(30);
  });

  it('stores 0 as a valid goal', () => {
    upsertSettings(db, 'alice@example.com', 0);
    const row = db.select().from(userSettings).where(eq(userSettings.userId, 'alice@example.com')).get();
    expect(row?.weeklyGoalHours).toBe(0);
  });

  it('stores 60-min increment', () => {
    upsertSettings(db, 'alice@example.com', 40, 60);
    const row = db.select().from(userSettings).where(eq(userSettings.userId, 'alice@example.com')).get();
    expect(row?.roundingIncrementMinutes).toBe(60);
  });

  it('stores 30-min increment', () => {
    upsertSettings(db, 'alice@example.com', 40, 30);
    const row = db.select().from(userSettings).where(eq(userSettings.userId, 'alice@example.com')).get();
    expect(row?.roundingIncrementMinutes).toBe(30);
  });
});

describe('settings PUT validation schema', () => {
  it('accepts integer values 0–40 with increment 60', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: 0, roundingIncrementMinutes: 60 })).not.toThrow();
    expect(() => updateSchema.parse({ weeklyGoalHours: 20, roundingIncrementMinutes: 60 })).not.toThrow();
    expect(() => updateSchema.parse({ weeklyGoalHours: 40, roundingIncrementMinutes: 60 })).not.toThrow();
  });

  it('accepts increment of 30', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: 40, roundingIncrementMinutes: 30 })).not.toThrow();
  });

  it('rejects values above 40', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: 41, roundingIncrementMinutes: 60 })).toThrow();
  });

  it('rejects values below 0', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: -1, roundingIncrementMinutes: 60 })).toThrow();
  });

  it('rejects non-integer weeklyGoalHours', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: 37.5, roundingIncrementMinutes: 60 })).toThrow();
  });

  it('rejects non-numeric weeklyGoalHours', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: '40', roundingIncrementMinutes: 60 })).toThrow();
    expect(() => updateSchema.parse({ weeklyGoalHours: null, roundingIncrementMinutes: 60 })).toThrow();
  });

  it('rejects increment values other than 30 or 60', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: 40, roundingIncrementMinutes: 15 })).toThrow();
    expect(() => updateSchema.parse({ weeklyGoalHours: 40, roundingIncrementMinutes: 45 })).toThrow();
    expect(() => updateSchema.parse({ weeklyGoalHours: 40, roundingIncrementMinutes: 120 })).toThrow();
    expect(() => updateSchema.parse({ weeklyGoalHours: 40, roundingIncrementMinutes: 0 })).toThrow();
  });

  it('rejects missing roundingIncrementMinutes', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: 40 })).toThrow();
  });

  it('rejects non-numeric roundingIncrementMinutes', () => {
    expect(() => updateSchema.parse({ weeklyGoalHours: 40, roundingIncrementMinutes: '60' })).toThrow();
    expect(() => updateSchema.parse({ weeklyGoalHours: 40, roundingIncrementMinutes: null })).toThrow();
  });
});
