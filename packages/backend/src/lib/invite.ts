import { createHash, randomBytes } from 'crypto';

/**
 * Invite tokens (D2, Phase C).
 *
 * The token is 32 random bytes — unguessable by construction — and only its
 * SHA-256 is stored, exactly like a session id. A database leak therefore
 * yields no usable invite link, and there is nothing to pepper: the token
 * already has full entropy before hashing (unlike a password, where a slow KDF
 * is needed because the input is human-chosen).
 */

/** D2: a single-use invite link is valid for 72 hours. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export const INVITE_TOKEN_BYTES = 32;

/** A fresh raw token. Goes in the invite link and is never stored. */
export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

/** The stored form of a token: hex SHA-256. */
export function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * The one failure message every bad token produces (unknown, used, expired).
 *
 * Used-and-expired are reported identically on purpose: distinguishing them
 * would tell whoever holds a stale link whether the account it created still
 * exists.
 */
export const INVITE_INVALID_MESSAGE = 'This invite link is invalid or has expired.';
