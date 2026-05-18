import { integer, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull().default('#6366f1'),
    workdayCode: text('workday_code'),
    billable: integer('billable', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    targetCadence: text('target_cadence', { enum: ['monthly', 'weekly', 'one_time'] }),
    targetMinutes: integer('target_minutes'),
    targetStartedAt: text('target_started_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_categories_user_name').on(t.userId, t.name),
  ]
);

export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    startTime: text('start_time').notNull(), // UTC ISO 8601
    endTime: text('end_time'), // null = timer running
    notes: text('notes'),
    rounded: integer('rounded', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_entries_user_start').on(t.userId, t.startTime),
    index('idx_entries_user_category').on(t.userId, t.categoryId),
  ]
);

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').primaryKey(),
  weeklyGoalHours: integer('weekly_goal_hours').notNull().default(40),
  roundingIncrementMinutes: integer('rounding_increment_minutes').notNull().default(60),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull(), // sha256 hex of the raw token — never store the raw token
    label: text('label').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    lastUsedAt: text('last_used_at'), // null until first use
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [uniqueIndex('idx_api_tokens_hash').on(t.tokenHash)]
);

export const monthlyProjectGoals = sqliteTable('monthly_project_goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  categoryId: integer('category_id')
    .notNull()
    .references(() => categories.id),
  monthYear: text('month_year').notNull(), // Format: YYYY-MM (e.g., '2026-05')
  availableHours: integer('available_hours').notNull(), // Total available hours for the month
  availableMinutes: integer('available_minutes').notNull(), // Stored as minutes for calculations
  lastUpdated: text('last_updated')
    .notNull()
    .default(sql`(datetime('now'))`)
});

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type TimeEntryRow = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
export type UserSettingsRow = typeof userSettings.$inferSelect;
export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
