import { and, eq, sql } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/client.js';
import {
  apiTokens,
  categories,
  monthlyProjectGoals,
  recoveryCodes,
  sessions,
  timeEntries,
  userSettings,
  users,
  type UserRow,
} from '../db/schema.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { checkPasswordPolicy } from '../lib/passwordPolicy.js';
import {
  revokeAllSessions,
  rotateSession,
  type CreatedSession,
} from '../lib/session.js';
import { recordAuthEvent } from './authService.js';
import { isUserUniqueViolation } from './inviteService.js';
import { findUserByEmail, findUserById } from './userService.js';

/**
 * Self-service account lifecycle (plan §7 Phase C).
 *
 * Four operations, each with its own guard:
 *
 *   * profile update — username is immutable, email must stay unique (Q14/Q15);
 *   * password change — verify the current password, then kill every *other*
 *     session and rotate the caller's own (D4, session fixation);
 *   * account deletion — password re-entry, typed confirmation, hard cascade,
 *     and never the last administrator (D6);
 *   * session listing/revocation — own sessions only, no cross-user
 *     administration (Q7/Q11).
 *
 * Every one of them writes an `auth_events` row (Q12).
 */

export const DISPLAY_NAME_MAX_LENGTH = 100;

export const PASSWORD_INCORRECT_MESSAGE = 'Current password is incorrect.';
export const NO_PASSWORD_MESSAGE =
  'This account has no password yet. Ask an administrator for a reset code.';
export const EMAIL_TAKEN_MESSAGE = 'An account with that email already exists.';
export const USERNAME_TAKEN_MESSAGE = 'That username is already taken.';
export const USERNAME_IMMUTABLE_MESSAGE = 'Usernames cannot be changed.';
export const CONFIRM_MISMATCH_MESSAGE = 'Type your username exactly to confirm deletion.';
export const LAST_ADMIN_MESSAGE = 'The last administrator account cannot be deleted.';

/**
 * A migrated or proxy-provisioned account carries an `unusable$` sentinel
 * instead of a hash: no password exists, so no password can be verified or set
 * without an admin-issued reset code (Q3/D5).
 */
function hasUsablePassword(user: UserRow): boolean {
  return !user.mustSetPassword && user.passwordHash.startsWith('scrypt$');
}

export interface UpdateProfileInput {
  userId: string;
  /** `undefined` means "not supplied"; `null` or `''` clears it. */
  displayName?: string | null;
  email?: string;
  ip?: string | null;
  userAgent?: string | null;
  database?: AppDatabase;
}

export type UpdateProfileOutcome =
  | { status: 'ok'; user: UserRow }
  | { status: 'not_found' }
  | { status: 'email_taken' };

export function updateProfile(input: UpdateProfileInput): UpdateProfileOutcome {
  const database = input.database ?? defaultDb;
  const user = findUserById(input.userId, database);
  if (!user) {
    return { status: 'not_found' };
  }

  const changes: Partial<typeof users.$inferInsert> = {};
  const events: string[] = [];

  if (input.displayName !== undefined) {
    const trimmed = (input.displayName ?? '').trim();
    const next = trimmed.length === 0 ? null : trimmed.slice(0, DISPLAY_NAME_MAX_LENGTH);
    if (next !== (user.displayName ?? null)) {
      changes.displayName = next;
      events.push('profile_update');
    }
  }

  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (email !== user.email) {
      const existing = findUserByEmail(email, database);
      if (existing && existing.id !== user.id) {
        return { status: 'email_taken' };
      }
      changes.email = email;
      events.push('email_change');
    }
  }

  if (Object.keys(changes).length === 0) {
    // Nothing changed, so nothing is written and nothing is audited.
    return { status: 'ok', user };
  }

  let updated: UserRow;
  try {
    updated = database
      .update(users)
      .set(changes)
      .where(eq(users.id, user.id))
      .returning()
      .get();
  } catch (error) {
    // A concurrent insert won the race between the check above and this write.
    if (isUserUniqueViolation(error, 'email')) {
      return { status: 'email_taken' };
    }
    throw error;
  }

  for (const kind of events) {
    recordAuthEvent(
      { userId: user.id, kind, ip: input.ip ?? null, userAgent: input.userAgent ?? null },
      database
    );
  }

  return { status: 'ok', user: updated };
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
  /** Raw id of the caller's session, when they authenticated with one. */
  currentSessionId?: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
  database?: AppDatabase;
}

export type ChangePasswordOutcome =
  | {
      status: 'ok';
      user: UserRow;
      /** The replacement session, when the caller presented one. */
      session: CreatedSession | null;
      otherSessionsRevoked: number;
    }
  | { status: 'not_found' }
  | { status: 'no_password' }
  | { status: 'incorrect' }
  | { status: 'unchanged' }
  | { status: 'policy'; message: string };

export function changePassword(input: ChangePasswordInput): ChangePasswordOutcome {
  const database = input.database ?? defaultDb;
  const now = input.now ?? new Date();

  const user = findUserById(input.userId, database);
  if (!user) {
    return { status: 'not_found' };
  }

  if (!hasUsablePassword(user)) {
    return { status: 'no_password' };
  }

  if (!verifyPassword(input.currentPassword, user.passwordHash)) {
    return { status: 'incorrect' };
  }

  if (input.newPassword === input.currentPassword) {
    return { status: 'unchanged' };
  }

  const policy = checkPasswordPolicy(input.newPassword, {
    username: user.username,
    email: user.email,
  });
  if (!policy.ok) {
    return { status: 'policy', message: policy.message };
  }

  const updated = database
    .update(users)
    .set({
      passwordHash: hashPassword(input.newPassword),
      passwordUpdatedAt: now.toISOString(),
      mustSetPassword: false,
    })
    .where(eq(users.id, user.id))
    .returning()
    .get();

  // A password change is the moment a stolen session becomes worthless: every
  // other device is signed out, and the caller's own id is replaced rather
  // than reused (D4 session fixation).
  const otherSessionsRevoked = revokeAllSessions(
    user.id,
    input.currentSessionId ? { exceptRawId: input.currentSessionId } : {},
    database
  );

  const session = input.currentSessionId
    ? rotateSession(
        input.currentSessionId,
        {
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          now,
        },
        database
      )
    : null;

  recordAuthEvent(
    {
      userId: user.id,
      kind: 'password_change',
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      meta: { otherSessionsRevoked },
    },
    database
  );

  return { status: 'ok', user: updated, session, otherSessionsRevoked };
}

export interface DeleteOwnAccountInput {
  userId: string;
  password: string;
  /** Typed confirmation; the frontend asks for the username, the API checks it. */
  confirmUsername: string;
  ip?: string | null;
  userAgent?: string | null;
  database?: AppDatabase;
}

export type DeleteOwnAccountOutcome =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'no_password' }
  | { status: 'incorrect' }
  | { status: 'confirm_mismatch' }
  | { status: 'last_admin' };

/**
 * Hard delete of the caller's account (D6).
 *
 * The cascade is written out rather than left to the foreign keys for two
 * reasons: the delete order is deterministic (entries and goals before the
 * categories they reference), and the guarantee holds even on a database opened
 * without `PRAGMA foreign_keys = ON`.
 */
export function deleteOwnAccount(input: DeleteOwnAccountInput): DeleteOwnAccountOutcome {
  const database = input.database ?? defaultDb;
  const user = findUserById(input.userId, database);
  if (!user) {
    return { status: 'not_found' };
  }

  if (input.confirmUsername.trim().toLowerCase() !== user.username) {
    return { status: 'confirm_mismatch' };
  }

  if (!hasUsablePassword(user)) {
    return { status: 'no_password' };
  }

  if (!verifyPassword(input.password, user.passwordHash)) {
    return { status: 'incorrect' };
  }

  if (user.role === 'admin') {
    const row = database
      .select({ value: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.disabled, false)))
      .get();

    // An instance with no administrator cannot be administered: the operator
    // would have to reach into the database. Refuse the last one.
    if ((row?.value ?? 0) <= 1) {
      return { status: 'last_admin' };
    }
  }

  database.transaction((tx) => {
    tx.delete(timeEntries).where(eq(timeEntries.userId, user.id)).run();
    tx.delete(monthlyProjectGoals).where(eq(monthlyProjectGoals.userId, user.id)).run();
    tx.delete(categories).where(eq(categories.userId, user.id)).run();
    tx.delete(userSettings).where(eq(userSettings.userId, user.id)).run();
    tx.delete(apiTokens).where(eq(apiTokens.userId, user.id)).run();
    tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id)).run();
    tx.delete(sessions).where(eq(sessions.userId, user.id)).run();
    tx.delete(users).where(eq(users.id, user.id)).run();
  });

  // `auth_events.user_id` is deliberately not a foreign key, so this row
  // survives the account it describes (Q12).
  recordAuthEvent(
    {
      userId: user.id,
      kind: 'account_deleted',
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      meta: { role: user.role },
    },
    database
  );

  return { status: 'ok' };
}
