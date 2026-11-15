import { randomInt, randomUUID } from 'crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/client.js';
import { recoveryCodes, users, type UserRow } from '../db/schema.js';
import { decryptSecret, encryptSecret } from '../lib/mfaCrypto.js';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from '../lib/password.js';
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from '../lib/totp.js';
import {
  completeLogin,
  findUserByLogin,
  findUserById,
  recordAuthEvent,
  type CompletedLogin,
} from './authService.js';
import {
  checkAccountLock,
  checkMfaLock,
  clearAccountFailures,
  clearMfaFailures,
  recordAccountFailure,
  recordMfaFailure,
  registerMfaIpAttempt,
} from './authLockout.js';

/**
 * TOTP MFA and single-use recovery codes (Phase D, D3).
 *
 * Lifecycle, and why it is shaped this way:
 *
 *   enrol   → generate a secret, store it **encrypted** as a *pending* value
 *             (`mfa_enabled` stays 0), return secret + `otpauth://` URI once.
 *             Nothing about login changes: an unconfirmed secret can never
 *             satisfy a challenge because challenges only exist when
 *             `mfa_enabled` is 1.
 *   confirm → verify a code against the pending secret, and only then flip
 *             `mfa_enabled`, record the accepted step, mint 10 recovery codes
 *             (hashed) and return them exactly once.
 *   login   → `POST /api/auth/login/mfa` completes the Phase B challenge with a
 *             TOTP code *or* a recovery code.
 *   disable → password + a fresh session (Q17); clears the secret and the
 *             recovery codes.
 *
 * Nothing in this module logs a secret, an `otpauth://` URI, a code or a hash.
 *
 * Replay protection stores the accepted *step* (`mfa_last_step`), never the
 * code, and the write is a compare-and-set:
 *
 *   UPDATE users SET mfa_last_step = <step>
 *    WHERE id = ? AND (mfa_last_step IS NULL OR mfa_last_step < <step>)
 *
 * Zero changed rows means the step (or a later one) was already used, which is
 * exactly the RFC 6238 replay case — including two requests racing with the
 * same code.
 */

export const MFA_ISSUER = 'Time Keeper';

/** 10 codes, 10 characters each (D3). */
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 10;

/**
 * Crockford-ish alphabet: no I, L, O, U, 0 or 1, so a code read off a screen
 * and typed back is not defeated by character confusion.
 */
const RECOVERY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTVWXYZ';

export const MFA_ALREADY_ENABLED_MESSAGE =
  'Two-factor authentication is already enabled for this account.';
export const MFA_NOT_STARTED_MESSAGE =
  'Start two-factor authentication setup before confirming a code.';
export const MFA_NOT_ENABLED_MESSAGE = 'Two-factor authentication is not enabled for this account.';
export const MFA_CODE_INVALID_MESSAGE = 'That code is not valid. Try again.';
export const MFA_PASSWORD_INCORRECT_MESSAGE = 'Current password is incorrect.';
export const MFA_NO_PASSWORD_MESSAGE =
  'This account has no password yet. Ask an administrator for a reset code.';

function hasUsablePassword(user: UserRow): boolean {
  return !user.mustSetPassword && user.passwordHash.startsWith('scrypt$');
}

/** `ABCDE-FGHJK` for display; the stored hash covers the compact form. */
export function formatRecoveryCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Uppercase, alphanumerics only — what a human retyping a code produces. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function generateRecoveryCode(): string {
  let code = '';
  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    code += RECOVERY_CODE_ALPHABET[randomInt(0, RECOVERY_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Recovery codes are hashed with the same versioned scrypt used for passwords
 * (D3: "Argon2id/scrypt-hashed"). A fast digest would be wrong here: the code
 * space is ~49 bits, which is only out of reach if each guess is expensive.
 */
export function hashRecoveryCode(code: string): string {
  return hashPassword(normalizeRecoveryCode(code));
}

export type EnrolOutcome =
  | { status: 'ok'; secret: string; otpauthUri: string }
  | { status: 'not_found' }
  | { status: 'already_enabled' };

export interface EnrolInput {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  database?: AppDatabase;
}

/**
 * Begin enrolment: a fresh secret, stored encrypted as *pending*.
 *
 * Calling it again replaces the pending secret (the previous QR code stops
 * working), which is what a user who lost the first screen expects. An account
 * that is already enrolled is refused rather than silently re-seeded: silently
 * overwriting an active secret would break every working authenticator.
 */
export function startEnrolment(input: EnrolInput): EnrolOutcome {
  const database = input.database ?? defaultDb;
  const user = findUserById(input.userId, database);
  if (!user) {
    return { status: 'not_found' };
  }
  if (user.mfaEnabled) {
    return { status: 'already_enabled' };
  }

  const secret = generateTotpSecret();

  database
    .update(users)
    .set({ mfaSecretEnc: encryptSecret(secret), mfaEnabled: false, mfaLastStep: null })
    .where(eq(users.id, user.id))
    .run();

  recordAuthEvent(
    { userId: user.id, kind: 'mfa_enrol_started', ip: input.ip ?? null, userAgent: input.userAgent ?? null },
    database
  );

  return {
    status: 'ok',
    secret,
    otpauthUri: buildOtpAuthUri({ secret, accountName: user.username, issuer: MFA_ISSUER }),
  };
}

export type ConfirmEnrolmentOutcome =
  | { status: 'ok'; recoveryCodes: string[] }
  | { status: 'not_found' }
  | { status: 'already_enabled' }
  | { status: 'not_started' }
  | { status: 'invalid' };

export interface ConfirmEnrolmentInput {
  userId: string;
  code: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
  database?: AppDatabase;
}

/**
 * Activate a pending secret, and only on a valid code.
 *
 * The recovery codes are returned in plaintext exactly once, here; only their
 * scrypt hashes are stored, so they cannot be shown again. The whole flip is one
 * transaction: an account can never end up `mfa_enabled = 1` without its
 * recovery codes, which would be a locked-out account waiting to happen.
 */
export function confirmEnrolment(input: ConfirmEnrolmentInput): ConfirmEnrolmentOutcome {
  const database = input.database ?? defaultDb;
  const now = input.now ?? new Date();

  const user = findUserById(input.userId, database);
  if (!user) {
    return { status: 'not_found' };
  }
  if (user.mfaEnabled) {
    return { status: 'already_enabled' };
  }
  if (!user.mfaSecretEnc) {
    return { status: 'not_started' };
  }

  const secret = decryptSecret(user.mfaSecretEnc);
  if (!secret) {
    // A corrupt or wrong-key ciphertext is unusable; make the user start again
    // rather than pretending a code was wrong.
    return { status: 'not_started' };
  }

  const match = verifyTotp(secret, input.code, { now });
  if (!match) {
    recordAuthEvent(
      {
        userId: user.id,
        kind: 'mfa_enrol_confirm_failed',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      database
    );
    return { status: 'invalid' };
  }

  const plaintextCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

  database.transaction((tx) => {
    tx.update(users)
      .set({ mfaEnabled: true, mfaLastStep: match.step })
      .where(eq(users.id, user.id))
      .run();

    tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id)).run();

    for (const code of plaintextCodes) {
      tx.insert(recoveryCodes)
        .values({
          id: randomUUID(),
          userId: user.id,
          codeHash: hashRecoveryCode(code),
          usedAt: null,
        })
        .run();
    }

    recordAuthEvent(
      {
        userId: user.id,
        kind: 'mfa_enrolled',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        meta: { recoveryCodes: plaintextCodes.length },
      },
      tx
    );
  });

  return { status: 'ok', recoveryCodes: plaintextCodes.map(formatRecoveryCode) };
}

export type DisableOutcome =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'not_enabled' }
  | { status: 'no_password' }
  | { status: 'incorrect' };

export interface DisableInput {
  userId: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
  database?: AppDatabase;
}

/**
 * Turn MFA off. Q17: password re-entry plus a session fresher than five
 * minutes (enforced by the route's `requireFreshSession`).
 *
 * The secret and every recovery code are deleted, not just flagged: a disabled
 * account that still holds a working secret is one bug away from being
 * re-enabled by an attacker who has read the database.
 */
export function disableMfa(input: DisableInput): DisableOutcome {
  const database = input.database ?? defaultDb;
  const user = findUserById(input.userId, database);
  if (!user) {
    return { status: 'not_found' };
  }
  if (!user.mfaEnabled) {
    return { status: 'not_enabled' };
  }
  if (!hasUsablePassword(user)) {
    return { status: 'no_password' };
  }
  if (!verifyPassword(input.password, user.passwordHash)) {
    return { status: 'incorrect' };
  }

  database.transaction((tx) => {
    tx.update(users)
      .set({ mfaEnabled: false, mfaSecretEnc: null, mfaLastStep: null })
      .where(eq(users.id, user.id))
      .run();

    tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id)).run();

    recordAuthEvent(
      {
        userId: user.id,
        kind: 'mfa_disabled',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      tx
    );
  });

  return { status: 'ok' };
}

export type RegenerateOutcome =
  | { status: 'ok'; recoveryCodes: string[] }
  | { status: 'not_found' }
  | { status: 'not_enabled' }
  | { status: 'no_password' }
  | { status: 'incorrect' };

export interface RegenerateInput {
  userId: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
  database?: AppDatabase;
}

/**
 * Replace every recovery code. The old set is deleted in the same transaction
 * that stores the new one, so there is never a moment with two live sets (or
 * with none).
 */
export function regenerateRecoveryCodes(input: RegenerateInput): RegenerateOutcome {
  const database = input.database ?? defaultDb;
  const user = findUserById(input.userId, database);
  if (!user) {
    return { status: 'not_found' };
  }
  if (!user.mfaEnabled) {
    return { status: 'not_enabled' };
  }
  if (!hasUsablePassword(user)) {
    return { status: 'no_password' };
  }
  if (!verifyPassword(input.password, user.passwordHash)) {
    return { status: 'incorrect' };
  }

  const plaintextCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

  database.transaction((tx) => {
    tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id)).run();

    for (const code of plaintextCodes) {
      tx.insert(recoveryCodes)
        .values({
          id: randomUUID(),
          userId: user.id,
          codeHash: hashRecoveryCode(code),
          usedAt: null,
        })
        .run();
    }

    recordAuthEvent(
      {
        userId: user.id,
        kind: 'mfa_recovery_codes_regenerated',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        meta: { recoveryCodes: plaintextCodes.length },
      },
      tx
    );
  });

  return { status: 'ok', recoveryCodes: plaintextCodes.map(formatRecoveryCode) };
}

/**
 * Consume a recovery code, atomically.
 *
 * Every stored hash is checked (no early exit), so the time taken does not
 * reveal the position of the match. The mark-used write is a compare-and-set on
 * `used_at IS NULL`, so two requests presenting the same code cannot both
 * succeed.
 */
function consumeRecoveryCode(
  userId: string,
  code: string,
  now: Date,
  database: AppDatabase
): boolean {
  const rows = database
    .select()
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
    .all();

  if (rows.length === 0) {
    return false;
  }

  const normalized = normalizeRecoveryCode(code);
  let matchedId: string | null = null;

  for (const row of rows) {
    // `verifyPassword` is constant-time inside; the loop never breaks early, so
    // the elapsed time does not reveal which row matched.
    const isMatch = verifyPassword(normalized, row.codeHash);
    if (isMatch && matchedId === null) {
      matchedId = row.id;
    }
  }

  if (!matchedId) {
    return false;
  }

  const result = database
    .update(recoveryCodes)
    .set({ usedAt: now.toISOString() })
    .where(and(eq(recoveryCodes.id, matchedId), isNull(recoveryCodes.usedAt)))
    .run();

  return result.changes > 0;
}

export type MfaLoginOutcome =
  | ({ status: 'ok' } & CompletedLogin)
  | { status: 'invalid' }
  | { status: 'code_invalid' }
  | { status: 'not_enabled' }
  | { status: 'rate_limited'; retryAfterMs: number };

export interface MfaLoginInput {
  identifier: string;
  password: string;
  /** A 6-digit TOTP code, or a recovery code in any human notation. */
  code: string;
  ip: string;
  userAgent?: string | null;
  existingSessionId?: string;
  now?: Date;
  database?: AppDatabase;
}

/**
 * Complete an MFA challenge (plan §5: `POST /api/auth/login/mfa`).
 *
 * The password is re-verified here rather than carried in a server-side
 * half-authenticated token: Phase B deliberately issued no cookie and no
 * challenge token, and requiring the same password again means a stolen
 * "challenge" is worthless on its own. Cost: the client keeps the password in
 * memory for one extra request, which is the same memory it already had.
 *
 * A wrong *password* is a password failure (same counter as `/login`). A wrong
 * *code* is an MFA failure, on its own gentler counter, so code-guessing cannot
 * lock the password path — see `authLockout.ts`.
 */
export function loginWithMfa(input: MfaLoginInput): MfaLoginOutcome {
  const database = input.database ?? defaultDb;
  const now = input.now ?? new Date();
  const identifier = input.identifier.trim();

  const ipAttempt = registerMfaIpAttempt(input.ip, { now, database });
  if (!ipAttempt.allowed) {
    recordAuthEvent(
      { kind: 'mfa_rate_limited', ip: input.ip, userAgent: input.userAgent },
      database
    );
    return { status: 'rate_limited', retryAfterMs: ipAttempt.retryAfterMs };
  }

  const user = findUserByLogin(identifier, database);
  const accountSubject = user ? `user:${user.id}` : `id:${identifier.toLowerCase()}`;

  const lock = checkAccountLock(accountSubject, { now, database });
  if (lock.locked) {
    recordAuthEvent({ kind: 'login_locked', ip: input.ip, userAgent: input.userAgent }, database);
    return { status: 'rate_limited', retryAfterMs: lock.retryAfterMs };
  }

  // Same shape as `/login`: a missing account still pays for one scrypt.
  const storedHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const usableHash = Boolean(user && hasUsablePassword(user));
  const passwordOk = verifyPassword(input.password, usableHash ? storedHash : DUMMY_PASSWORD_HASH);

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

  clearAccountFailures(accountSubject, database);

  if (!user.mfaEnabled) {
    // The password was right but there is no challenge to complete. This is not
    // a credential failure, so it is reported as its own state.
    return { status: 'not_enabled' };
  }

  const mfaLock = checkMfaLock(user.id, { now, database });
  if (mfaLock.locked) {
    recordAuthEvent(
      { userId: user.id, kind: 'mfa_locked', ip: input.ip, userAgent: input.userAgent },
      database
    );
    return { status: 'rate_limited', retryAfterMs: mfaLock.retryAfterMs };
  }

  const trimmedCode = input.code.trim();
  // A TOTP code may be pasted with a space or a dash in the middle ("123 456").
  const looksLikeTotp = /^\d{6}$/.test(trimmedCode.replace(/[\s-]/g, ''));

  if (looksLikeTotp) {
    const secret = user.mfaSecretEnc ? decryptSecret(user.mfaSecretEnc) : null;
    const match = secret ? verifyTotp(secret, trimmedCode, { now }) : null;

    if (!match) {
      recordMfaFailure(user.id, { now, database });
      recordAuthEvent(
        { userId: user.id, kind: 'mfa_code_rejected', ip: input.ip, userAgent: input.userAgent },
        database
      );
      return { status: 'code_invalid' };
    }

    // Compare-and-set: the first request to use this step wins. Anything at or
    // below the recorded step is a replay, including a concurrent duplicate.
    const guard = database
      .update(users)
      .set({ mfaLastStep: match.step })
      .where(
        and(
          eq(users.id, user.id),
          or(isNull(users.mfaLastStep), lt(users.mfaLastStep, match.step))
        )
      )
      .run();

    if (guard.changes === 0) {
      recordMfaFailure(user.id, { now, database });
      recordAuthEvent(
        {
          userId: user.id,
          kind: 'mfa_code_replay_rejected',
          ip: input.ip,
          userAgent: input.userAgent,
        },
        database
      );
      return { status: 'code_invalid' };
    }

    clearMfaFailures(user.id, database);
    recordAuthEvent(
      { userId: user.id, kind: 'mfa_code_accepted', ip: input.ip, userAgent: input.userAgent },
      database
    );

    return { status: 'ok', ...completeLogin({ user, ...loginContext(input, now), database }) };
  }

  // --- Recovery-code path ---
  if (consumeRecoveryCode(user.id, trimmedCode, now, database)) {
    clearMfaFailures(user.id, database);
    recordAuthEvent(
      {
        userId: user.id,
        kind: 'mfa_recovery_code_used',
        ip: input.ip,
        userAgent: input.userAgent,
      },
      database
    );

    return { status: 'ok', ...completeLogin({ user, ...loginContext(input, now), database }) };
  }

  recordMfaFailure(user.id, { now, database });
  recordAuthEvent(
    { userId: user.id, kind: 'mfa_code_rejected', ip: input.ip, userAgent: input.userAgent },
    database
  );
  return { status: 'code_invalid' };
}

function loginContext(input: MfaLoginInput, now: Date) {
  return {
    ip: input.ip,
    userAgent: input.userAgent ?? null,
    existingSessionId: input.existingSessionId,
    now,
  };
}
