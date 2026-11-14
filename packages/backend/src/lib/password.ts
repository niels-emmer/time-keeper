import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Password hashing (plan §3, A2). Stdlib only — `crypto.scrypt`, no new
 * dependency.
 *
 * Stored format is a versioned, self-describing string:
 *
 *   scrypt$v1$<N>$<r>$<p>$<salt-base64url>$<key-base64url>
 *
 * The parameters travel with the hash, so they can be raised later without
 * invalidating existing hashes: `needsRehash()` reports which stored hashes are
 * behind the current cost, and a successful login can then re-hash in place.
 *
 * Accounts migrated from the pre-accounts era carry an `unusable$<random>`
 * sentinel instead (Q3): no password was generated for them, and
 * `verifyPassword()` can never accept one. `needsRehash()` treats that prefix
 * as "no usable hash yet".
 */

export const SCRYPT_N = 2 ** 15; // 32768
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SALT_BYTES = 16;
export const KEY_BYTES = 64;

export const PASSWORD_PREFIX = 'scrypt';
export const PASSWORD_VERSION = 'v1';
export const UNUSABLE_PASSWORD_PREFIX = 'unusable$';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export const DEFAULT_PARAMS: ScryptParams = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P };

/**
 * scrypt needs 128 * N * r bytes of memory: 33.5 MiB at the chosen cost, over
 * Node's 32 MiB default `maxmem`. The ceiling here is twice that, which leaves
 * headroom without allowing an attacker-supplied stored hash to allocate
 * unbounded memory (the parsed parameters are range-checked below as well).
 */
function maxmemFor(params: ScryptParams): number {
  return 128 * params.N * params.r * 2;
}

function deriveKey(password: string, salt: Buffer, keyLength: number, params: ScryptParams): Buffer {
  return scryptSync(password, salt, keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: maxmemFor(params),
  });
}

/** Hash a password with the current cost parameters. */
export function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS): string {
  const salt = randomBytes(SALT_BYTES);
  const key = deriveKey(password, salt, KEY_BYTES, params);

  return [
    PASSWORD_PREFIX,
    PASSWORD_VERSION,
    params.N,
    params.r,
    params.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Constant-time string comparison.
 *
 * Both inputs are reduced to a SHA-256 digest first, so the comparison is
 * constant-time regardless of length: `timingSafeEqual` throws on length
 * mismatch, and branching on the length would itself leak it. Used for CSRF
 * tokens, recovery codes and reset codes as well as password digests.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

interface ParsedPasswordHash {
  params: ScryptParams;
  salt: Buffer;
  key: Buffer;
}

function parsePasswordHash(stored: string): ParsedPasswordHash | null {
  const parts = stored.split('$');
  if (parts.length !== 7) {
    return null;
  }

  const [prefix, version, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
  if (prefix !== PASSWORD_PREFIX || version !== PASSWORD_VERSION) {
    return null;
  }

  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);

  // Range-check before deriving: the parameters come from stored data, and a
  // corrupted or hostile row must not be able to request gigabytes or an
  // effectively infinite loop.
  if (!Number.isInteger(N) || N < 2 ** 10 || N > 2 ** 20 || (N & (N - 1)) !== 0) {
    return null;
  }
  if (!Number.isInteger(r) || r < 1 || r > 16) {
    return null;
  }
  if (!Number.isInteger(p) || p < 1 || p > 4) {
    return null;
  }

  let salt: Buffer;
  let key: Buffer;
  try {
    salt = Buffer.from(saltRaw, 'base64url');
    key = Buffer.from(keyRaw, 'base64url');
  } catch {
    return null;
  }

  if (salt.length !== SALT_BYTES || key.length === 0 || key.length > 128) {
    return null;
  }

  return { params: { N, r, p }, salt, key };
}

/**
 * True only when `password` produces the stored key.
 *
 * Any malformed, unknown-prefix or sentinel value returns false — never throws,
 * so a corrupted row cannot turn a login attempt into a 500 that distinguishes
 * it from a wrong password.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parsed = parsePasswordHash(stored);
  if (!parsed) {
    return false;
  }

  const candidate = deriveKey(password, parsed.salt, parsed.key.length, parsed.params);
  return timingSafeEqual(candidate, parsed.key);
}

/**
 * True when the stored hash was produced with different parameters than the
 * current defaults (or holds no usable hash at all), so the caller can re-hash
 * on the next successful login.
 */
export function needsRehash(stored: string, params: ScryptParams = DEFAULT_PARAMS): boolean {
  const parsed = parsePasswordHash(stored);
  if (!parsed) {
    return true;
  }

  return (
    parsed.params.N !== params.N ||
    parsed.params.r !== params.r ||
    parsed.params.p !== params.p ||
    parsed.key.length !== KEY_BYTES
  );
}

/**
 * A real hash of an unguessable password, used when no user matched the login
 * identifier so that the unknown-user path costs the same scrypt work as the
 * wrong-password path (plan §3, login enumeration).
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$v1$32768$8$1$dGstZHVtbXktc2FsdC12MQ$Y7mnWttyO3iHLHyJ2N-LqQlFYMR4ZF2mOSCax6IWaIRANM6oRWWD-_DsIOXd4mTQFeTikVL2yULTPjHUyf6TTQ';

/** An `unusable$<random>` sentinel: not a hash, and unverifiable by design. */
export function createUnusablePasswordHash(): string {
  return UNUSABLE_PASSWORD_PREFIX + randomBytes(16).toString('hex');
}
