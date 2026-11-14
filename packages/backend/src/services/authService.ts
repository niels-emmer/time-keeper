import { eq, or } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/client.js';
import { authEvents, users, type UserRow } from '../db/schema.js';
import { generateCsrfToken } from '../lib/csrf.js';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../lib/password.js';
import { createSession, revokeSession, type CreatedSession } from '../lib/session.js';
import {
  checkAccountLock,
  clearAccountFailures,
  recordAccountFailure,
  registerIpAttempt,
} from './authLockout.js';

/**
 * Local password authentication (Phase B, plan §3 / §5).
 *
 * The login identifier is a username **or** an email (Q5). Usernames and emails
 * are both stored lower-cased, so one indexed lookup covers both.
 *
 * Enumeration resistance is structural, not cosmetic:
 *
 *   * A missing account verifies the supplied password against a real scrypt
 *     hash (`DUMMY_PASSWORD_HASH`), so the unknown-user path does the same work
 *     as the wrong-password path.
 *   * Every rejection reason — unknown user, wrong password, disabled account,
 *     `must_set_password` sentinel — produces the same `invalid` outcome and
 *     the same generic message.
 *   * The per-account backoff key is recorded for identifiers that match no
 *     user as well, so a 429 cannot be used to learn that an account exists.
 */

/** Phase D implements this endpoint. Phase B only produces the typed state. */
export const MFA_COMPLETION_PATH = '/api/auth/login/mfa';

/** The account summary every auth response is allowed to expose. */
export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: 'user' | 'admin';
  mfaEnabled: boolean;
  mustSetPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/**
 * Explicit allowlist serialiser. Never spread a `users` row into a response:
 * `password_hash`, `mfa_secret_enc`, `mfa_last_step` and `invited_by` must not
 * leave the database through an API.
 */
export function serializeUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName ?? null,
    role: user.role === 'admin' ? 'admin' : 'user',
    mfaEnabled: user.mfaEnabled,
    mustSetPassword: user.mustSetPassword,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

export function findUserByLogin(
  identifier: string,
  database: AppDatabase = defaultDb
): UserRow | undefined {
  const normalized = identifier.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  return database
    .select()
    .from(users)
    .where(or(eq(users.email, normalized), eq(users.username, normalized)))
    .get();
}

export function findUserById(
  id: string,
  database: AppDatabase = defaultDb
): UserRow | undefined {
  return database.select().from(users).where(eq(users.id, id)).get();
}

export interface RecordAuthEventInput {
  userId?: string | null;
  kind: string;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

export function recordAuthEvent(
  input: RecordAuthEventInput,
  database: AppDatabase = defaultDb
): void {
  database
    .insert(authEvents)
    .values({
      userId: input.userId ?? null,
      kind: input.kind,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metaJson: input.meta ? JSON.stringify(input.meta) : null,
    })
    .run();
}

export type LoginOutcome =
  | {
      status: 'ok';
      user: UserRow;
      session: CreatedSession;
      csrfToken: string;
    }
  | { status: 'mfa_required' }
  | { status: 'invalid' }
  | { status: 'rate_limited'; retryAfterMs: number };

export interface LoginInput {
  /** Username or email, already trim-normalised is not required. */
  identifier: string;
  password: string;
  ip: string;
  userAgent?: string | null;
  /** A session cookie presented with the login request; killed on success (fixation). */
  existingSessionId?: string;
  now?: Date;
  database?: AppDatabase;
}

export function loginWithPassword(input: LoginInput): LoginOutcome {
  const database = input.database ?? defaultDb;
  const now = input.now ?? new Date();
  const identifier = input.identifier.trim();

  // 1. Per-IP ceiling first: it is the cheapest check and applies before the
  //    account-specific machinery, so a spray never reaches scrypt.
  const ipAttempt = registerIpAttempt(input.ip, { now, database });
  if (!ipAttempt.allowed) {
    recordAuthEvent(
      { kind: 'login_rate_limited', ip: input.ip, userAgent: input.userAgent },
      database
    );
    return { status: 'rate_limited', retryAfterMs: ipAttempt.retryAfterMs };
  }

  // 2. Resolve the identifier before the account lock so username and email map
  //    to ONE backoff key. Keying on the submitted string alone would let an
  //    attacker alternate aliases to double their attempts.
  const user = findUserByLogin(identifier, database);
  const accountSubject = user
    ? `user:${user.id}`
    : `id:${identifier.toLowerCase()}`;

  const lock = checkAccountLock(accountSubject, { now, database });
  if (lock.locked) {
    recordAuthEvent(
      { kind: 'login_locked', ip: input.ip, userAgent: input.userAgent },
      database
    );
    return { status: 'rate_limited', retryAfterMs: lock.retryAfterMs };
  }

  // 3. Verify against a real hash in every case.
  const storedHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const usableHash = Boolean(
    user && !user.mustSetPassword && storedHash.startsWith('scrypt$')
  );

  const passwordOk = verifyPassword(
    input.password,
    usableHash ? storedHash : DUMMY_PASSWORD_HASH
  );

  if (!user || !usableHash || !passwordOk || user.disabled) {
    recordAccountFailure(accountSubject, { now, database });
    recordAuthEvent(
      {
        userId: user?.id ?? null,
        kind: 'login_failure',
        ip: input.ip,
        userAgent: input.userAgent,
      },
      database
    );
    return { status: 'invalid' };
  }

  // The password was correct, so any prior failure streak is over.
  clearAccountFailures(accountSubject, database);

  // Transparent hash upgrade when the stored cost is behind the current one.
  if (needsRehash(user.passwordHash)) {
    database
      .update(users)
      .set({ passwordHash: hashPassword(input.password), passwordUpdatedAt: now.toISOString() })
      .where(eq(users.id, user.id))
      .run();
  }

  // Phase D: MFA completion is not implemented in this phase. The correct
  // password is acknowledged with a typed `mfa_required` state and **no
  // session cookie**, so there is no partial authentication to exploit.
  if (user.mfaEnabled) {
    recordAuthEvent(
      { userId: user.id, kind: 'login_mfa_challenge', ip: input.ip, userAgent: input.userAgent },
      database
    );
    return { status: 'mfa_required' };
  }

  // Session fixation: whatever the client presented is dead before the new id
  // exists. The raw id is never reused.
  if (input.existingSessionId) {
    revokeSession(input.existingSessionId, database);
  }

  const session = createSession(
    {
      userId: user.id,
      ip: input.ip,
      userAgent: input.userAgent ?? null,
      now,
    },
    database
  );

  database.update(users).set({ lastLoginAt: now.toISOString() }).where(eq(users.id, user.id)).run();

  recordAuthEvent(
    { userId: user.id, kind: 'login_success', ip: input.ip, userAgent: input.userAgent },
    database
  );

  return {
    status: 'ok',
    user: { ...user, lastLoginAt: now.toISOString() },
    session,
    csrfToken: generateCsrfToken(),
  };
}
