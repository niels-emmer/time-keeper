import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

const targetCadenceSchema = z.enum(['monthly', 'weekly', 'one_time']);
const targetMinutesSchema = z.number().int().min(1).max(525_600);

function withTargetValidation<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).superRefine((value, ctx) => {
    const hasTargetCadence = Object.prototype.hasOwnProperty.call(value, 'targetCadence');
    const hasTargetMinutes = Object.prototype.hasOwnProperty.call(value, 'targetMinutes');

    if (!hasTargetCadence && !hasTargetMinutes) {
      return;
    }

    const targetCadence = value.targetCadence;
    const targetMinutes = value.targetMinutes;

    if (targetCadence == null && targetMinutes == null) {
      return;
    }

    if (targetCadence == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetCadence'],
        message: 'targetCadence is required when targetMinutes is set.',
      });
    }

    if (targetMinutes == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetMinutes'],
        message: 'targetMinutes is required when targetCadence is set.',
      });
    }
  });
}

const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  workdayCode: text('workday_code'),
  billable: integer('billable', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  targetCadence: text('target_cadence'),
  targetMinutes: integer('target_minutes'),
  targetStartedAt: text('target_started_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

const createSchema = withTargetValidation({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  workdayCode: z.string().max(100).optional(),
  billable: z.boolean().optional(),
  targetCadence: targetCadenceSchema.nullable().optional(),
  targetMinutes: targetMinutesSchema.nullable().optional(),
});

const updateSchema = withTargetValidation({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  workdayCode: z.string().max(100).nullable().optional(),
  billable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  targetCadence: targetCadenceSchema.nullable().optional(),
  targetMinutes: targetMinutesSchema.nullable().optional(),
});

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      workday_code TEXT,
      billable INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      target_cadence TEXT,
      target_minutes INTEGER,
      target_started_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return drizzle(sqlite, { schema: { categories } });
}

describe('categories route validation', () => {
  it('accepts billable and target fields on create', () => {
    expect(() => createSchema.parse({
      name: 'Project A',
      billable: true,
      targetCadence: 'weekly',
      targetMinutes: 600,
    })).not.toThrow();
  });

  it('accepts nullable workdayCode and clearing target fields on update', () => {
    expect(() => updateSchema.parse({
      billable: false,
      workdayCode: null,
      targetCadence: null,
      targetMinutes: null,
    })).not.toThrow();
  });

  it('rejects invalid billable or incomplete target values', () => {
    expect(() => createSchema.parse({ name: 'Project A', billable: 'yes' })).toThrow();
    expect(() => updateSchema.parse({ billable: 1 })).toThrow();
    expect(() => createSchema.parse({ name: 'Project A', targetCadence: 'monthly' })).toThrow();
    expect(() => createSchema.parse({ name: 'Project A', targetMinutes: 120 })).toThrow();
  });
});

describe('categories target persistence', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  it('defaults target fields to null when omitted', () => {
    const row = db.insert(categories).values({
      userId: 'alice@example.com',
      name: 'Project A',
      color: '#6366f1',
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning().get();

    expect(row?.targetCadence).toBeNull();
    expect(row?.targetMinutes).toBeNull();
    expect(row?.targetStartedAt).toBeNull();
  });

  it('stores recurring targets without affecting another user row', () => {
    const alice = db.insert(categories).values({
      userId: 'alice@example.com',
      name: 'Project A',
      color: '#6366f1',
      billable: true,
      sortOrder: 0,
      targetCadence: 'monthly',
      targetMinutes: 1200,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning().get()!;

    db.insert(categories).values({
      userId: 'bob@example.com',
      name: 'Project A',
      color: '#6366f1',
      billable: false,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();

    db.update(categories)
      .set({ targetCadence: 'weekly', targetMinutes: 600, updatedAt: new Date().toISOString() })
      .where(and(eq(categories.id, alice.id), eq(categories.userId, 'alice@example.com')))
      .run();

    const aliceRow = db.select().from(categories).where(eq(categories.userId, 'alice@example.com')).get();
    const bobRow = db.select().from(categories).where(eq(categories.userId, 'bob@example.com')).get();

    expect(aliceRow?.targetCadence).toBe('weekly');
    expect(aliceRow?.targetMinutes).toBe(600);
    expect(bobRow?.targetCadence).toBeNull();
    expect(bobRow?.targetMinutes).toBeNull();
  });
});
