import { randomUUID } from 'crypto';
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase, type DatabaseExecutor } from '../db/client.js';
import {
  apiTokens,
  authEvents,
  categories,
  monthlyProjectGoals,
  passwordResetCodes,
  recoveryCodes,
  sessions,
  timeEntries,
  userSettings,
  users,
  type AuthEventRow,
  type UserRow,
} from '../db/schema.js';
import { createUnusablePasswordHash } from '../lib/password.js';
import { revokeAllSessions } from '../lib/session.js';
import { recordAuthEvent } from './authService.js';
import { isUserUniqueViolation } from './inviteService.js';
import { issueResetCode } from './resetService.js';
import { findUserById, isValidUsername, normalizeEmail } from './userService.js';

/**
 * Administrator user management (Phase E, plan §5/Q11/Q16).
 *
 * Target scale is 2–10 users, so there are deliberately **no bulk operations**,
 * no force-MFA-reset and no cross-user session administration. Every function
 * here is a single-target operation whose guards are the point:
 *
 *   * the last enabled administrator can never be demoted, disabled or deleted;
 *   * disabling revokes that account's sessions in the same transaction, so the
 *     revoke cannot be forgotten;
 *   * deletion requires an explicit mode, and reassignment moves entries (and
 *     resolves category-name collisions) before the account row disappears.
 *
 * Every mutation writes an `auth_events` row whose `user_id` is the **acting
 * administrator**; the affected account is named in `meta.targetUserId`.
 */

export const LAST_ADMIN_MESSAGE = 'The last administrator account cannot be removed or demoted.';
export const USERNAME_TAKEN_MESSAGE = 'That username is already taken.';
export const EMAIL_TAKEN_MESSAGE = 'An account with that email already exists.';
export const USERNAME_FORMAT_MESSAGE =
  'Usernames are 3–32 characters: lowercase letters, numbers, hyphens and underscores.';

export interface AdminUserSummary {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: 'user' | 'admin';
  disabled: boolean;
  mfaEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  entryCount: number;
}

/** Allowlist serialiser for a single account on the admin surface. */
export function serializeAdminUser(
  user: UserRow
): Omit<AdminUserSummary, 'entryCount'> & { mustSetPassword: boolean } {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName ?? null,
    role: user.role === 'admin' ? 'admin' : 'user',
    disabled: user.disabled,
    mfaEnabled: user.mfaEnabled,
    mustSetPassword: user.mustSetPassword,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

/** Never includes `password_hash`, `mfa_secret_enc` or recovery codes. */
export function listAdminUsers(database: AppDatabase = defaultDb): AdminUserSummary[] {
  return database
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      disabled: users.disabled,
      mfaEnabled: users.mfaEnabled,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      entryCount: sql<number>`(select count(*) from time_entries where time_entries.user_id = users.id)`,
    })
    .from(users)
    .orderBy(asc(users.createdAt))
    .all()
    .map((row) => ({
      ...row,
      role: row.role === 'admin' ? 'admin' : 'user',
      entryCount: Number(row.entryCount),
    }));
}

export type CreateAdminUserOutcome =
  | { status: 'ok'; user: UserRow; resetCode: string; resetExpiresAt: string }
  | { status: 'email_taken' }
  | { status: 'username_taken' }
  | { status: 'username_invalid' };

export interface CreateAdminUserInput {
  email: string;
  username: string;
  role: 'user' | 'admin';
  actorId: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
  database?: AppDatabase;
}

/**
 * Create an account directly and issue a 60-minute reset code so the new person
 * chooses their own password (D5 — there is no SMTP).
 *
 * The account starts with an unusable password hash and `must_set_password`, so
 * there is no temporary credential to leak or to share: the reset code is the
 * only way in, it is returned exactly once, and nothing derived from a password
 * is ever generated or logged.
 */
export function createAdminUser(input: CreateAdminUserInput): CreateAdminUserOutcome {
  const database = input.database ?? defaultDb;
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const username = input.username.trim().toLowerCase();

  if (!isValidUsername(username)) {
    return { status: 'username_invalid' };
  }

  let user: UserRow;
  try {
    user = database
      .insert(users)
      .values({
        id: randomUUID(),
        email,
        username,
        passwordHash: createUnusablePasswordHash(),
        role: input.role,
        mustSetPassword: true,
      })
      .returning()
      .get();
  } catch (error) {
    if (isUserUniqueViolation(error, 'email')) {
      return { status: 'email_taken' };
    }
    if (isUserUniqueViolation(error, 'username')) {
      return { status: 'username_taken' };
    }
    throw error;
  }

  recordAuthEvent(
    {
      userId: input.actorId,
      kind: 'user_created',
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      meta: { targetUserId: user.id, email: user.email, role: user.role },
    },
    database
  );

  const issued = issueResetCode({
    userId: user.id,
    actorId: input.actorId,
    ip: input.ip,
    userAgent: input.userAgent,
    now,
    database,
    kind: 'password_reset_issued',
  });

  if (!issued) {
    // The row was just inserted, so this cannot happen unless the database is
    // broken; surfacing it is better than returning a user with no way in.
    throw new Error('Failed to issue a reset code for the newly created user.');
  }

  return {
    status: 'ok',
    user,
    resetCode: issued.code,
    resetExpiresAt: issued.expiresAt,
  };
}

function enabledAdminCount(database: DatabaseExecutor): number {
  const row = database
    .select({ value: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, false)))
    .get();
  return Number(row?.value ?? 0);
}

export type UpdateAdminUserOutcome =
  | { status: 'ok'; user: UserRow }
  | { status: 'not_found' }
  | { status: 'last_admin' };

export interface UpdateAdminUserInput {
  targetId: string;
  actorId: string;
  role?: 'user' | 'admin';
  disabled?: boolean;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
  database?: AppDatabase;
}

/**
 * Change a role and/or disable/enable an account.
 *
 * Two guards, one query: the last *enabled* administrator cannot be demoted or
 * disabled. That covers both "cannot demote the last admin" and "cannot
 * self-demote as the last admin" — the second is the same rule seen from the
 * caller's own row, which is why there is no separate self-check.
 *
 * Disabling takes effect immediately: every session row for the account is
 * deleted in the same transaction as the flag, so an already-open tab cannot
 * keep working.
 */
export function updateAdminUser(input: UpdateAdminUserInput): UpdateAdminUserOutcome {
  const database = input.database ?? defaultDb;
  const target = findUserById(input.targetId, database);
  if (!target) {
    return { status: 'not_found' };
  }

  const nextRole = input.role ?? target.role;
  const nextDisabled = input.disabled ?? target.disabled;
  const roleChanged = nextRole !== target.role;
  const disabledChanged = nextDisabled !== target.disabled;

  const losesAdmin =
    target.role === 'admin' &&
    !target.disabled &&
    (nextRole !== 'admin' || nextDisabled);
  if (losesAdmin && enabledAdminCount(database) <= 1) {
    return { status: 'last_admin' };
  }

  if (!roleChanged && !disabledChanged) {
    return { status: 'ok', user: target };
  }

  const updated = database.transaction((tx) => {
    const row = tx
      .update(users)
      .set({
        ...(roleChanged ? { role: nextRole } : {}),
        ...(disabledChanged ? { disabled: nextDisabled } : {}),
      })
      .where(eq(users.id, target.id))
      .returning()
      .get();

    // Disabling revokes live sessions as part of the same write, so there is no
    // window where the account is blocked but its cookies still work.
    if (disabledChanged && nextDisabled) {
      revokeAllSessions(target.id, {}, tx);
    }

    if (roleChanged) {
      recordAuthEvent(
        {
          userId: input.actorId,
          kind: 'user_role_changed',
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          meta: { targetUserId: target.id, from: target.role, to: nextRole },
        },
        tx
      );
    }

    if (disabledChanged) {
      recordAuthEvent(
        {
          userId: input.actorId,
          kind: nextDisabled ? 'user_disabled' : 'user_enabled',
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          meta: { targetUserId: target.id },
        },
        tx
      );
    }

    return row;
  });

  return { status: 'ok', user: updated };
}

export type DeleteAdminUserMode = 'cascade' | 'reassign';

export interface DeleteAdminUserResult {
  mode: DeleteAdminUserMode;
  entriesReassigned: number;
  categoriesMoved: number;
  categoriesMerged: number;
}

export type DeleteAdminUserOutcome =
  | { status: 'ok'; result: DeleteAdminUserResult }
  | { status: 'not_found' }
  | { status: 'last_admin' }
  | { status: 'open_timer_conflict' };

export interface DeleteAdminUserInput {
  targetId: string;
  actorId: string;
  /** Q16: the caller must pick cascade or reassign-entries-to-themselves. */
  mode: DeleteAdminUserMode;
  ip?: string | null;
  userAgent?: string | null;
  database?: AppDatabase;
}

/**
 * Hard-delete another account (D6/Q16).
 *
 * `cascade` removes every user-scoped row. `reassign` moves the account's time
 * entries to the acting administrator first, so their history is not destroyed:
 *
 *   1. time entries change owner;
 *   2. each category the account owned is either moved to the administrator,
 *      or — when the administrator already has a category with the same name,
 *      which the `(user_id, name)` unique index forbids moving — the entries
 *      pointing at it are re-pointed at the administrator's existing category
 *      and the duplicate category row is deleted. Re-pointing before deleting
 *      is what leaves no dangling `category_id`.
 *   3. everything that cannot meaningfully be reassigned (settings, tokens,
 *      sessions, recovery codes, reset codes, monthly goals) is deleted, and
 *      finally the account row itself.
 *
 * The last enabled administrator cannot be deleted.
 */
export function deleteAdminUser(input: DeleteAdminUserInput): DeleteAdminUserOutcome {
  const database = input.database ?? defaultDb;
  const target = findUserById(input.targetId, database);
  if (!target) {
    return { status: 'not_found' };
  }

  if (target.role === 'admin' && !target.disabled && enabledAdminCount(database) <= 1) {
    return { status: 'last_admin' };
  }

  // I-003: at most one open timer per user. Reassigning an open entry to an
  // administrator who already has one would break the partial unique index
  // mid-transaction. Refusing is honest — silently stopping someone's running
  // timer would alter their recorded time.
  if (input.mode === 'reassign') {
    const openTarget = database
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, target.id), isNull(timeEntries.endTime)))
      .get();
    const openActor = database
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, input.actorId), isNull(timeEntries.endTime)))
      .get();

    if (openTarget && openActor) {
      return { status: 'open_timer_conflict' };
    }
  }

  const result = database.transaction((tx) => {
    let entriesReassigned = 0;
    let categoriesMoved = 0;
    let categoriesMerged = 0;

    if (input.mode === 'reassign') {
      // Goals reference categories; they are user-scoped budgets with no
      // meaning on the administrator's account, so they go with the account.
      tx.delete(monthlyProjectGoals).where(eq(monthlyProjectGoals.userId, target.id)).run();

      entriesReassigned = tx
        .update(timeEntries)
        .set({ userId: input.actorId })
        .where(eq(timeEntries.userId, target.id))
        .run().changes;

      const owned = tx
        .select()
        .from(categories)
        .where(eq(categories.userId, target.id))
        .all();

      for (const category of owned) {
        const existing = tx
          .select()
          .from(categories)
          .where(and(eq(categories.userId, input.actorId), eq(categories.name, category.name)))
          .get();

        if (existing) {
          // The name is already taken on the administrator's account. Move the
          // entries onto that category and drop the duplicate; deleting the
          // category first would orphan the entries.
          tx.update(timeEntries)
            .set({ categoryId: existing.id })
            .where(
              and(
                eq(timeEntries.categoryId, category.id),
                eq(timeEntries.userId, input.actorId)
              )
            )
            .run();
          tx.delete(categories).where(eq(categories.id, category.id)).run();
          categoriesMerged += 1;
        } else {
          tx.update(categories)
            .set({ userId: input.actorId })
            .where(eq(categories.id, category.id))
            .run();
          categoriesMoved += 1;
        }
      }
    } else {
      tx.delete(timeEntries).where(eq(timeEntries.userId, target.id)).run();
      tx.delete(monthlyProjectGoals).where(eq(monthlyProjectGoals.userId, target.id)).run();
      tx.delete(categories).where(eq(categories.userId, target.id)).run();
    }

    tx.delete(userSettings).where(eq(userSettings.userId, target.id)).run();
    tx.delete(apiTokens).where(eq(apiTokens.userId, target.id)).run();
    tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, target.id)).run();
    tx.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, target.id)).run();
    tx.delete(sessions).where(eq(sessions.userId, target.id)).run();
    tx.delete(users).where(eq(users.id, target.id)).run();

    recordAuthEvent(
      {
        userId: input.actorId,
        kind: 'user_deleted',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        meta: {
          targetUserId: target.id,
          targetEmail: target.email,
          mode: input.mode,
          entriesReassigned,
          categoriesMoved,
          categoriesMerged,
        },
      },
      tx
    );

    return { mode: input.mode, entriesReassigned, categoriesMoved, categoriesMerged };
  });

  return { status: 'ok', result };
}

// ---------------------------------------------------------------------------
// Audit viewer (Q12)
// ---------------------------------------------------------------------------

export const AUTH_EVENT_RETENTION_DAYS = 90;
export const AUTH_EVENT_PAGE_SIZE = 50;
export const AUTH_EVENT_MAX_PAGE_SIZE = 100;

export interface AuthEventView {
  id: number;
  kind: string;
  actor: { id: string; email: string; username: string } | null;
  ip: string | null;
  userAgent: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface ListAuthEventsInput {
  page?: number;
  limit?: number;
  database?: AppDatabase;
}

export interface ListAuthEventsResult {
  events: AuthEventView[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

function parseMeta(metaJson: string | null): Record<string, unknown> | null {
  if (!metaJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(metaJson) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Paginated audit trail. `auth_events.user_id` is not a foreign key, so a
 * deleted actor's events survive and the join simply yields no actor row.
 */
export function listAuthEvents(input: ListAuthEventsInput = {}): ListAuthEventsResult {
  const database = input.database ?? defaultDb;
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const limit = Math.min(
    AUTH_EVENT_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(input.limit ?? AUTH_EVENT_PAGE_SIZE))
  );

  const totalRow = database
    .select({ value: sql<number>`count(*)` })
    .from(authEvents)
    .get();
  const total = Number(totalRow?.value ?? 0);

  const rows = database
    .select({
      event: authEvents,
      actorId: users.id,
      actorEmail: users.email,
      actorUsername: users.username,
    })
    .from(authEvents)
    .leftJoin(users, eq(users.id, authEvents.userId))
    .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
    .limit(limit)
    .offset((page - 1) * limit)
    .all();

  const events: AuthEventView[] = rows.map((row: { event: AuthEventRow; actorId: string | null; actorEmail: string | null; actorUsername: string | null }) => ({
    id: row.event.id,
    kind: row.event.kind,
    actor:
      row.actorId && row.actorEmail && row.actorUsername
        ? { id: row.actorId, email: row.actorEmail, username: row.actorUsername }
        : null,
    ip: row.event.ip ?? null,
    userAgent: row.event.userAgent ?? null,
    meta: parseMeta(row.event.metaJson),
    createdAt: row.event.createdAt,
  }));

  return {
    events,
    page,
    limit,
    total,
    hasMore: page * limit < total,
  };
}

/**
 * Q12 retention: drop audit rows older than 90 days.
 *
 * Called opportunistically on every admin read/write of the audit surface, so
 * the table cannot grow without bound on a self-hosted install that has no
 * scheduler. One indexed `DELETE` is cheap at this scale.
 */
export function pruneAuthEvents(
  options: { retentionDays?: number; now?: Date; database?: AppDatabase } = {}
): number {
  const database = options.database ?? defaultDb;
  const now = options.now ?? new Date();
  const days = options.retentionDays ?? AUTH_EVENT_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  return database.delete(authEvents).where(lt(authEvents.createdAt, cutoff)).run().changes;
}
