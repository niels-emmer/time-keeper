import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const monthlyProjectGoals = sqliteTable('monthly_project_goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  categoryId: integer('category_id').notNull(),
  monthYear: text('month_year').notNull(),
  availableHours: integer('available_hours').notNull().default(0),
  availableMinutes: integer('available_minutes').notNull().default(0),
  lastUpdated: text('last_updated').notNull().default(sql`(datetime('now'))`),
});

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE monthly_project_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      month_year TEXT NOT NULL,
      available_hours INTEGER NOT NULL DEFAULT 0,
      available_minutes INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, category_id, month_year)
    )
  `);
  return drizzle(sqlite, { schema: { monthlyProjectGoals } });
}

function normalizeMonthYear(dateStr: string): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function getMonthlyGoal(
  db: ReturnType<typeof makeDb>,
  userId: string,
  categoryId: number,
  monthYear: string
) {
  const rows = await db.select({
    availableHours: monthlyProjectGoals.availableHours,
    availableMinutes: monthlyProjectGoals.availableMinutes,
  })
    .from(monthlyProjectGoals)
    .where(and(
      eq(monthlyProjectGoals.userId, userId),
      eq(monthlyProjectGoals.categoryId, categoryId),
      eq(monthlyProjectGoals.monthYear, monthYear)
    ))
    .limit(1);

  return rows[0] ?? null;
}

async function setMonthlyGoal(
  db: ReturnType<typeof makeDb>,
  userId: string,
  categoryId: number,
  monthYear: string,
  hours: number,
  minutes: number
) {
  const existing = await db.select({ id: monthlyProjectGoals.id })
    .from(monthlyProjectGoals)
    .where(and(
      eq(monthlyProjectGoals.userId, userId),
      eq(monthlyProjectGoals.categoryId, categoryId),
      eq(monthlyProjectGoals.monthYear, monthYear)
    ))
    .limit(1);

  if (existing.length > 0) {
    await db.update(monthlyProjectGoals)
      .set({ availableHours: hours, availableMinutes: minutes, lastUpdated: new Date().toISOString() })
      .where(and(
        eq(monthlyProjectGoals.userId, userId),
        eq(monthlyProjectGoals.categoryId, categoryId),
        eq(monthlyProjectGoals.monthYear, monthYear)
      ));
    return;
  }

  await db.insert(monthlyProjectGoals).values({
    userId,
    categoryId,
    monthYear,
    availableHours: hours,
    availableMinutes: minutes,
    lastUpdated: new Date().toISOString(),
  }).run();
}

describe('normalizeMonthYear', () => {
  it('normalizes full dates to YYYY-MM', () => {
    expect(normalizeMonthYear('2026-05-17')).toBe('2026-05');
  });

  it('returns null for invalid input', () => {
    expect(normalizeMonthYear('')).toBeNull();
    expect(normalizeMonthYear('not-a-date')).toBeNull();
  });
});

describe('monthly goal helper behavior', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  it('returns null when no goal exists', async () => {
    await expect(getMonthlyGoal(db, 'alice@example.com', 1, '2026-05')).resolves.toBeNull();
  });

  it('inserts a new monthly goal', async () => {
    await setMonthlyGoal(db, 'alice@example.com', 1, '2026-05', 12, 30);

    await expect(getMonthlyGoal(db, 'alice@example.com', 1, '2026-05')).resolves.toEqual({
      availableHours: 12,
      availableMinutes: 30,
    });
  });

  it('updates an existing monthly goal instead of duplicating it', async () => {
    await setMonthlyGoal(db, 'alice@example.com', 1, '2026-05', 12, 0);
    await setMonthlyGoal(db, 'alice@example.com', 1, '2026-05', 8, 45);

    const rows = db.select().from(monthlyProjectGoals).all();
    expect(rows).toHaveLength(1);

    await expect(getMonthlyGoal(db, 'alice@example.com', 1, '2026-05')).resolves.toEqual({
      availableHours: 8,
      availableMinutes: 45,
    });
  });

  it('isolates goals by user and month', async () => {
    await setMonthlyGoal(db, 'alice@example.com', 1, '2026-05', 10, 0);
    await setMonthlyGoal(db, 'bob@example.com', 1, '2026-05', 6, 0);
    await setMonthlyGoal(db, 'alice@example.com', 1, '2026-06', 14, 0);

    await expect(getMonthlyGoal(db, 'alice@example.com', 1, '2026-05')).resolves.toEqual({
      availableHours: 10,
      availableMinutes: 0,
    });
    await expect(getMonthlyGoal(db, 'bob@example.com', 1, '2026-05')).resolves.toEqual({
      availableHours: 6,
      availableMinutes: 0,
    });
    await expect(getMonthlyGoal(db, 'alice@example.com', 1, '2026-06')).resolves.toEqual({
      availableHours: 14,
      availableMinutes: 0,
    });
  });
});