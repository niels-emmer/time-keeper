import { createHash, randomBytes } from 'crypto';

/**
 * Password reset codes (D5, Phase E).
 *
 * There is no SMTP: an administrator issues a code from the user-management
 * screen and hands it over out of band. The code is 32 random bytes — full
 * entropy before hashing — so only its SHA-256 is stored, exactly like an invite
 * token or a session id. A slow KDF is unnecessary because no human chooses it.
 *
 * A code is valid for 60 minutes and exactly one use. Issuing a new code for the
 * same account deletes the old one, so a handed-over code cannot be replayed
 * after a newer one exists.
 */

/** D5: a reset code is valid for 60 minutes. */
export const RESET_CODE_TTL_MS = 60 * 60 * 1000;

export const RESET_CODE_BYTES = 32;

/** A fresh raw code. Goes into the admin response once and is never stored. */
export function generateResetCode(): string {
  return randomBytes(RESET_CODE_BYTES).toString('base64url');
}

/** The stored form of a code: hex SHA-256. */
export function hashResetCode(rawCode: string): string {
  return createHash('sha256').update(rawCode.trim(), 'utf8').digest('hex');
}

/**
 * The single failure message for an unknown, expired or already-used code.
 *
 * All three are reported identically on purpose: whoever holds a stale code
 * learns nothing about whether the account still exists.
 */
export const RESET_CODE_INVALID_MESSAGE = 'This reset code is invalid or has expired.';
