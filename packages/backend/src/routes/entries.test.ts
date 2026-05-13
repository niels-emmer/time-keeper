import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { assertEntryRange, createEntrySchema, updateEntrySchema } from '../utils/entryValidation.js';

const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
});

const timeEntries = sqliteTable('time_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  categoryId: integer('category_id').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
  notes: text('notes'),
  rounded: integer('rounded', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      notes TEXT,
      rounded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return drizzle(sqlite, { schema: { categories, timeEntries } });
}

describe('entries route validation', () => {
  it('accepts completed-entry payloads for create', () => {
    expect(() => createEntrySchema.parse({
      categoryId: 1,
      startTime: '2026-05-13T09:00:00.000Z',
      endTime: '2026-05-13T10:00:00.000Z',
      notes: 'Backfilled work',
    })).not.toThrow();
  });

  it('accepts partial updates including null notes', () => {
    expect(() => updateEntrySchema.parse({
      categoryId: 2,
      notes: null,
    })).not.toThrow();
  });

  it('rejects invalid time ranges', () => {
    expect(() => assertEntryRange('2026-05-13T10:00:00.000Z', '2026-05-13T09:00:00.000Z')).toThrow('End time must be after start time');
    expect(() => assertEntryRange('2026-05-13T10:00:00.000Z', '2026-05-13T10:00:00.000Z')).toThrow('End time must be after start time');
  });
});

describe('entries persistence guardrails', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  it('stores completed backfilled entries', () => {
    const category = db.insert(categories).values({
      userId: 'alice@example.com',
      name: 'Project Alpha',
    }).returning().get()!;

    const entry = db.insert(timeEntries).values({
      userId: 'alice@example.com',
      categoryId: category.id,
      startTime: '2026-05-13T09:00:00.000Z',
      endTime: '2026-05-13T10:30:00.000Z',
      notes: 'Recovered from notes',
      createdAt: '2026-05-13T10:31:00.000Z',
      updatedAt: '2026-05-13T10:31:00.000Z',
    }).returning().get();

    expect(entry?.endTime).toBe('2026-05-13T10:30:00.000Z');
    expect(entry?.notes).toBe('Recovered from notes');
  });

  it('updates only the owning user entry', () => {
    const aliceCategory = db.insert(categories).values({ userId: 'alice@example.com', name: 'Project Alpha' }).returning().get()!;
    const bobCategory = db.insert(categories).values({ userId: 'bob@example.com', name: 'Project Beta' }).returning().get()!;

    const aliceEntry = db.insert(timeEntries).values({
      userId: 'alice@example.com',
      categoryId: aliceCategory.id,
      startTime: '2026-05-13T09:00:00.000Z',
      endTime: '2026-05-13T10:00:00.000Z',
      notes: null,
      createdAt: '2026-05-13T10:01:00.000Z',
      updatedAt: '2026-05-13T10:01:00.000Z',
    }).returning().get()!;

    db.insert(timeEntries).values({
      userId: 'bob@example.com',
      categoryId: bobCategory.id,
      startTime: '2026-05-13T09:00:00.000Z',
      endTime: '2026-05-13T10:00:00.000Z',
      notes: null,
      createdAt: '2026-05-13T10:01:00.000Z',
      updatedAt: '2026-05-13T10:01:00.000Z',
    }).run();

    db.update(timeEntries)
      .set({ notes: 'Adjusted', updatedAt: '2026-05-13T11:00:00.000Z' })
      .where(and(eq(timeEntries.id, aliceEntry.id), eq(timeEntries.userId, 'alice@example.com')))
      .run();

    const aliceRow = db.select().from(timeEntries).where(eq(timeEntries.userId, 'alice@example.com')).get();
    const bobRow = db.select().from(timeEntries).where(eq(timeEntries.userId, 'bob@example.com')).get();

    expect(aliceRow?.notes).toBe('Adjusted');
    expect(bobRow?.notes).toBeNull();
  });
});
