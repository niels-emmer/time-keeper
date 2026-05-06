import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  workdayCode: text('workday_code'),
  bonus: integer('bonus', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  workdayCode: z.string().max(100).optional(),
  bonus: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  workdayCode: z.string().max(100).nullable().optional(),
  bonus: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
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
      bonus INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return drizzle(sqlite, { schema: { categories } });
}

describe('categories route validation', () => {
  it('accepts bonus on create', () => {
    expect(() => createSchema.parse({ name: 'Project A', bonus: true })).not.toThrow();
  });

  it('accepts bonus and nullable workdayCode on update', () => {
    expect(() => updateSchema.parse({ bonus: false, workdayCode: null })).not.toThrow();
  });

  it('rejects invalid bonus values', () => {
    expect(() => createSchema.parse({ name: 'Project A', bonus: 'yes' })).toThrow();
    expect(() => updateSchema.parse({ bonus: 1 })).toThrow();
  });
});

describe('categories bonus persistence', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  it('defaults bonus to false when omitted', () => {
    const row = db.insert(categories).values({
      userId: 'alice@example.com',
      name: 'Project A',
      color: '#6366f1',
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning().get();

    expect(row?.bonus).toBe(false);
  });

  it('stores bonus=true when explicitly set', () => {
    const row = db.insert(categories).values({
      userId: 'alice@example.com',
      name: 'Project A',
      color: '#6366f1',
      bonus: true,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning().get();

    expect(row?.bonus).toBe(true);
  });

  it('updates bonus without affecting another user row', () => {
    const alice = db.insert(categories).values({
      userId: 'alice@example.com',
      name: 'Project A',
      color: '#6366f1',
      bonus: false,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning().get()!;

    db.insert(categories).values({
      userId: 'bob@example.com',
      name: 'Project A',
      color: '#6366f1',
      bonus: false,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();

    db.update(categories)
      .set({ bonus: true, updatedAt: new Date().toISOString() })
      .where(and(eq(categories.id, alice.id), eq(categories.userId, 'alice@example.com')))
      .run();

    const aliceRow = db.select().from(categories).where(eq(categories.userId, 'alice@example.com')).get();
    const bobRow = db.select().from(categories).where(eq(categories.userId, 'bob@example.com')).get();

    expect(aliceRow?.bonus).toBe(true);
    expect(bobRow?.bonus).toBe(false);
  });
});