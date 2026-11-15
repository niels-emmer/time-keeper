import { integer, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * The identity record (D7). Every user-scoped table references `users.id`.
 *
 * Before Phase A the app had no accounts table: identity was the Authentik
 * email string, stored as the primary key of `user_id` on every table. That is
 * reversed here — see `docs/design/auth-accounts.md` §4 and §8.
 *
 * `email` is stored lower-cased and trimmed; uniqueness is enforced by the
 * `idx_users_email` unique index and by normalising at every write path, which
 * is what makes the proxy path's email lookup deterministic.
 *
 * `mfa_secret_enc` holds AES-256-GCM ciphertext (Phase D) — never plaintext.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    username: text('username').notNull(),
    // A versioned scrypt string (`scrypt$v1$N$r$p$salt$hash`) or, for migrated
    // accounts that never set a password, an unusable sentinel (`unusable$...`)
    // that no input can verify against (Q3).
    passwordHash: text('password_hash').notNull(),
    passwordUpdatedAt: text('password_updated_at'),
    role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
    displayName: text('display_name'),
    mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
    mfaSecretEnc: text('mfa_secret_enc'),
    mfaLastStep: integer('mfa_last_step'),
    mustSetPassword: integer('must_set_password', { mode: 'boolean' }).notNull().default(false),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    invitedBy: text('invited_by'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    lastLoginAt: text('last_login_at'),
  },
  (t) => [
    uniqueIndex('idx_users_email').on(t.email),
    uniqueIndex('idx_users_username').on(t.username),
  ]
);

/**
 * Server-side sessions (D4). Only the SHA-256 of the opaque session id is
 * stored, so a database leak does not hand over live sessions.
 *
 * `expires_at` is the idle deadline (14 days, slid forward on use);
 * `absolute_expires_at` is the hard 90-day cap (Q7).
 */
export const sessions = sqliteTable(
  'sessions',
  {
    idHash: text('id_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    lastSeenAt: text('last_seen_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    absoluteExpiresAt: text('absolute_expires_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [index('idx_sessions_user').on(t.userId)]
);

/** Single-use MFA recovery codes (D3). Only the hash is stored. */
export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: text('used_at'),
  },
  (t) => [index('idx_recovery_codes_user').on(t.userId)]
);

/** Single-use invite tokens (D2). Only the token hash is stored. */
export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    email: text('email'),
    role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
    createdBy: text('created_by'),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
  },
  (t) => [uniqueIndex('idx_invites_token_hash').on(t.tokenHash)]
);

/**
 * Single-use password reset codes (D5, Q3).
 *
 * There is no SMTP. An administrator issues a 60-minute code and hands it over
 * out of band; it is stored only as a SHA-256 so a database leak yields no
 * usable code. `created_by` and `used_at` make the lifecycle auditable without
 * turning this into a second auth surface.
 *
 * At most one code is usable per account: issuing a new one deletes the old row
 * in the same transaction, and redemption claims the row with a conditional
 * `UPDATE ... WHERE used_at IS NULL`.
 */
export const passwordResetCodes = sqliteTable(
  'password_reset_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    createdBy: text('created_by'),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
  },
  (t) => [
    index('idx_password_reset_codes_user').on(t.userId),
    uniqueIndex('idx_password_reset_codes_hash').on(t.codeHash),
  ]
);

/**
 * Persisted authentication-attempt counters (Q23, Phase B).
 *
 * Lockout must survive a restart: an in-memory limiter resets the moment the
 * process does, which is exactly what an attacker wants. Every counter is a
 * row here, keyed by scope (`ip:<addr>` or `acct:<normalised identifier>`).
 *
 * The account key is written for identifiers that match no user as well, so a
 * locked unknown identifier and a locked real account answer identically and
 * the response cannot be used to enumerate accounts.
 */
export const authAttempts = sqliteTable('auth_attempts', {
  attemptKey: text('attempt_key').primaryKey(),
  failureCount: integer('failure_count').notNull().default(0),
  /** Start of the current per-minute IP window; unused for account rows. */
  windowStartedAt: text('window_started_at').notNull(),
  /** When set and in the future, attempts for this key are refused. */
  lockedUntil: text('locked_until'),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Audit trail (Q12, 90-day retention). `user_id` is deliberately NOT a foreign
 * key: audit rows must survive the account they describe, and a failed login
 * has no user at all.
 */
export const authEvents = sqliteTable(
  'auth_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id'),
    kind: text('kind').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metaJson: text('meta_json'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [index('idx_auth_events_user_created').on(t.userId, t.createdAt)]
);

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    // Enforce invariant I-003 in the database: at most one open timer per user
    // (finding H-1). A partial index allows many completed rows but only one
    // row with `end_time IS NULL` for each user.
    uniqueIndex('idx_entries_one_open_per_user')
      .on(t.userId)
      .where(sql`end_time IS NULL`),
  ]
);

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  weeklyGoalHours: integer('weekly_goal_hours').notNull().default(40),
  roundingIncrementMinutes: integer('rounding_increment_minutes').notNull().default(60),
  // IANA zone used to bucket entries into local days (DEC-2 / finding H-3).
  // Default UTC keeps an untouched install behaving exactly as before.
  timezone: text('timezone').notNull().default('UTC'),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type RecoveryCodeRow = typeof recoveryCodes.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type PasswordResetCodeRow = typeof passwordResetCodes.$inferSelect;
export type AuthEventRow = typeof authEvents.$inferSelect;
export type AuthAttemptRow = typeof authAttempts.$inferSelect;
