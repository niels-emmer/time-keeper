import { randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/client.js';
import {
  passwordResetCodes,
  users,
  type UserRow,
} from '../db/schema.js';
import { hashPassword } from '../lib/password.js';
import { checkPasswordPolicy } from '../lib/passwordPolicy.js';
import {
  RESET_CODE_INVALID_MESSAGE,
  RESET_CODE_TTL_MS,
  generateResetCode,
  hashResetCode,
} from '../lib/resetCode.js';
import { revokeAllSessions } from '../lib/session.js';
import { recordAuthEvent } from './authService.js';
import { findUserById } from './userService.js';

/**
 * Admin-issued password reset codes (D5, Q3, Phase E).
 *
 * Issuing and redeeming are the two halves of the same rule: a code is
 * high-entropy, stored only as a SHA-256, valid for 60 minutes and usable
 * exactly once. Issuing a new code invalidates the previous one, so a code that
 * was already handed over stops working the moment a replacement exists.
 */

export interface IssuedResetCode {
  /** The raw code. Returned to the administrator once and never stored. */
  code: string;
  expiresAt: string;
}

export interface IssueResetCodeInput {
  userId: string;
  /** The acting administrator, for the audit row. `null` for bootstrap paths. */
  actorId?: string | null;
  kind?: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
  database?: AppDatabase;
}

/**
 * Issue a single-use reset code and invalidate any earlier one for the account.
 *
 * Returns `null` when the account does not exist. The delete-then-insert is one
 * transaction, so there is never a moment with two usable codes.
 */
export function issueResetCode(input: IssueResetCodeInput): IssuedResetCode | null {
  const database = input.database ?? defaultDb;
  const now = input.now ?? new Date();

  if (!findUserById(input.userId, database)) {
    return null;
  }

  const code = generateResetCode();
  const codeHash = hashResetCode(code);
  const expiresAt = new Date(now.getTime() + RESET_CODE_TTL_MS).toISOString();
  const id = randomUUID();

  database.transaction((tx) => {
    // A previous code stops working the moment a newer one exists.
    tx.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, input.userId)).run();

    tx.insert(passwordResetCodes)
      .values({
        id,
        userId: input.userId,
        codeHash,
        createdBy: input.actorId ?? null,
        expiresAt,
        usedAt: null,
      })
      .run();

    recordAuthEvent(
      {
        userId: input.actorId ?? null,
        kind: input.kind ?? 'password_reset_issued',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        meta: { targetUserId: input.userId, resetCodeId: id, expiresAt },
      },
      tx
    );
  });

  return { code, expiresAt };
}

class ResetClaimConflict extends Error {
  constructor() {
    super('Reset code already claimed');
    this.name = 'ResetClaimConflict';
  }
}

export type RedeemResetCodeOutcome =
  | { status: 'ok'; user: UserRow }
  | { status: 'invalid' }
  | { status: 'policy'; message: string };

export interface RedeemResetCodeInput {
  code: string;
  newPassword: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
  database?: AppDatabase;
}

/**
 * Redeem a reset code and set the account's password.
 *
 * Unknown, expired and already-used codes produce the same `invalid` outcome and
 * the same message: a stale code cannot be probed for whether its account still
 * exists. On success the password is written, `must_set_password` is cleared,
 * every session is revoked (a password change must not leave stolen cookies
 * alive) and the account is audited — all in one transaction with the
 * single-use claim.
 */
export function redeemResetCode(input: RedeemResetCodeInput): RedeemResetCodeOutcome {
  const database = input.database ?? defaultDb;
  const now = input.now ?? new Date();

  const row = database
    .select()
    .from(passwordResetCodes)
    .where(eq(passwordResetCodes.codeHash, hashResetCode(input.code)))
    .get();

  if (!row || row.usedAt) {
    return { status: 'invalid' };
  }

  if (new Date(row.expiresAt).getTime() <= now.getTime()) {
    return { status: 'invalid' };
  }

  const user = findUserById(row.userId, database);
  if (!user) {
    return { status: 'invalid' };
  }

  const policy = checkPasswordPolicy(input.newPassword, {
    username: user.username,
    email: user.email,
  });
  if (!policy.ok) {
    return { status: 'policy', message: policy.message };
  }

  try {
    const updated = database.transaction((tx) => {
      const claimed = tx
        .update(passwordResetCodes)
        .set({ usedAt: now.toISOString() })
        .where(and(eq(passwordResetCodes.id, row.id), isNull(passwordResetCodes.usedAt)))
        .run();

      if (claimed.changes !== 1) {
        throw new ResetClaimConflict();
      }

      const next = tx
        .update(users)
        .set({
          passwordHash: hashPassword(input.newPassword),
          passwordUpdatedAt: now.toISOString(),
          mustSetPassword: false,
        })
        .where(eq(users.id, user.id))
        .returning()
        .get();

      revokeAllSessions(user.id, {}, tx);

      // There should be no sibling row — issuance deletes the old one — but a
      // reset must never leave any other code usable.
      tx.delete(passwordResetCodes)
        .where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.usedAt)))
        .run();

      recordAuthEvent(
        {
          userId: user.id,
          kind: 'password_reset',
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          meta: { resetCodeId: row.id },
        },
        tx
      );

      return next;
    });

    return { status: 'ok', user: updated };
  } catch (error) {
    if (error instanceof ResetClaimConflict) {
      return { status: 'invalid' };
    }
    throw error;
  }
}

export { RESET_CODE_INVALID_MESSAGE };
