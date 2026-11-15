import { randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/client.js';
import { invites, users, type InviteRow, type UserRow } from '../db/schema.js';
import { generateInviteToken, hashInviteToken, INVITE_TTL_MS } from '../lib/invite.js';
import { hashPassword } from '../lib/password.js';

/**
 * Invite issuance and redemption (D2, plan §7 Phase C).
 *
 * One rule shapes this module: **the token is the only credential**. It is
 * generated server-side, mailed nowhere (there is no SMTP), handed over out of
 * band by whoever issued it, stored only as a SHA-256, valid for 72 hours and
 * usable exactly once.
 *
 * The single-use claim is a conditional `UPDATE ... WHERE used_at IS NULL`
 * inside the same transaction that inserts the account. A concurrent second
 * redemption therefore fails the claim rather than minting a second user, and
 * the invite cannot be left marked-used without the account it paid for.
 */

export type InviteRole = 'user' | 'admin';

export interface CreateInviteInput {
  /** Optional binding. When set, acceptance must use this exact address. */
  email?: string | null;
  role?: InviteRole;
  createdBy?: string | null;
  now?: Date;
  database?: AppDatabase;
}

export interface CreatedInvite {
  invite: InviteRow;
  /** The raw token. Returned to the issuer once and never stored. */
  token: string;
}

export function createInvite(input: CreateInviteInput = {}): CreatedInvite {
  const database = input.database ?? defaultDb;
  const now = input.now ?? new Date();
  const token = generateInviteToken();

  const invite: InviteRow = {
    id: randomUUID(),
    tokenHash: hashInviteToken(token),
    email: input.email ? input.email.trim().toLowerCase() : null,
    role: input.role ?? 'user',
    createdBy: input.createdBy ?? null,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    usedAt: null,
  };

  database.insert(invites).values(invite).run();

  return { invite, token };
}

/**
 * Resolve a raw token to a usable invite, or null.
 *
 * Unknown, already-used and expired all return null: the caller answers with a
 * single generic message so a stale link cannot be probed for whether the
 * account it created still exists.
 */
export function findUsableInvite(
  rawToken: string,
  options: { now?: Date } = {},
  database: AppDatabase = defaultDb
): InviteRow | null {
  const now = options.now ?? new Date();
  const token = rawToken.trim();
  if (token.length === 0) {
    return null;
  }

  const row = database
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, hashInviteToken(token)))
    .get();

  if (!row || row.usedAt) {
    return null;
  }

  if (new Date(row.expiresAt).getTime() <= now.getTime()) {
    return null;
  }

  return row;
}

class InviteClaimConflict extends Error {
  constructor() {
    super('Invite already claimed');
    this.name = 'InviteClaimConflict';
  }
}

/**
 * True when a write failed on the unique index of `users.<column>`.
 *
 * The check exists so a race between "is this email free?" and the insert
 * becomes a 409 rather than a 500. SQLite names the column in the message; the
 * index name is checked too because which one appears depends on the statement.
 */
export function isUserUniqueViolation(error: unknown, column: 'email' | 'username'): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? '';

  const isConstraint =
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT' ||
    /UNIQUE constraint failed/i.test(message);

  if (!isConstraint) {
    return false;
  }

  return message.includes(`users.${column}`) || message.includes(`idx_users_${column}`);
}

export type RegisterInviteOutcome =
  | { status: 'ok'; user: UserRow; invite: InviteRow }
  | { status: 'invalid' }
  | { status: 'email_taken' }
  | { status: 'username_taken' };

export interface RegisterInvitedUserInput {
  invite: InviteRow;
  /** Already format-validated and normalised by the caller. */
  email: string;
  username: string;
  password: string;
  now?: Date;
  database?: AppDatabase;
}

/**
 * Create the account an invite pays for, and burn the invite in one step.
 *
 * The role comes from the invite, never from the request body: acceptance
 * cannot escalate its own privileges.
 */
export function registerInvitedUser(input: RegisterInvitedUserInput): RegisterInviteOutcome {
  const database = input.database ?? defaultDb;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  try {
    const user = database.transaction((tx) => {
      const claimed = tx
        .update(invites)
        .set({ usedAt: nowIso })
        .where(and(eq(invites.id, input.invite.id), isNull(invites.usedAt)))
        .run();

      if (claimed.changes !== 1) {
        throw new InviteClaimConflict();
      }

      return tx
        .insert(users)
        .values({
          id: randomUUID(),
          email: input.email.trim().toLowerCase(),
          username: input.username.trim().toLowerCase(),
          passwordHash: hashPassword(input.password),
          passwordUpdatedAt: nowIso,
          role: input.invite.role === 'admin' ? 'admin' : 'user',
          mustSetPassword: false,
          invitedBy: input.invite.createdBy ?? null,
        })
        .returning()
        .get();
    });

    return { status: 'ok', user, invite: { ...input.invite, usedAt: nowIso } };
  } catch (error) {
    if (error instanceof InviteClaimConflict) {
      return { status: 'invalid' };
    }
    if (isUserUniqueViolation(error, 'email')) {
      return { status: 'email_taken' };
    }
    if (isUserUniqueViolation(error, 'username')) {
      return { status: 'username_taken' };
    }
    throw error;
  }
}
