import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Time-based one-time passwords (RFC 6238, D3), stdlib only.
 *
 * RFC 4226 HOTP with HMAC-SHA1, a 30-second step and 6 digits is what every
 * authenticator app implements by default, so there is no reason to add a
 * dependency for ~40 lines of arithmetic.
 *
 * Everything here is pure and takes an explicit timestamp: the RFC 6238 test
 * vectors in `totp.test.ts` are the evidence that the arithmetic is right, and
 * tests elsewhere can drive the clock instead of sleeping.
 *
 * Replay protection deliberately lives one layer up (`mfaService`) where it can
 * be enforced with an atomic compare-and-set against `users.mfa_last_step`.
 * `verifyTotp()` answers "which step does this code belong to?" and nothing else.
 */

/** RFC 6238 / RFC 4226 defaults, and what every authenticator app expects. */
export const TOTP_ALGORITHM = 'SHA1';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_STEP_MS = TOTP_STEP_SECONDS * 1000;
export const TOTP_DIGITS = 6;
/** 160-bit secret, the length RFC 4226 §4 recommends for HMAC-SHA1. */
export const TOTP_SECRET_BYTES = 20;
/** ±1 step tolerance for clock skew (D3). */
export const TOTP_DEFAULT_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, uppercase, unpadded — the format authenticator apps expect. */
export function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  const output: string[] = [];

  for (const byte of input) {
    value = ((value << 8) | byte) & ((1 << (bits + 8)) - 1);
    bits += 8;

    while (bits >= 5) {
      output.push(BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]);
      bits -= 5;
    }
  }

  if (bits > 0) {
    output.push(BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]);
  }

  return output.join('');
}

/**
 * Decode base32 as a human might retype it: lowercase, spaces and hyphens are
 * tolerated, trailing padding is stripped. Anything else outside the alphabet
 * throws — a corrupt secret is a server-side fault, not a failed login.
 */
export function base32Decode(input: string): Buffer {
  const normalised = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();

  if (normalised.length === 0) {
    throw new Error('base32Decode: empty input');
  }
  if (!/^[A-Z2-7]+$/.test(normalised)) {
    throw new Error('base32Decode: input is not valid base32');
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of normalised) {
    const index = BASE32_ALPHABET.indexOf(character);
    value = ((value << 5) | index) & ((1 << (bits + 5)) - 1);
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** A fresh 160-bit secret in the encoding authenticator apps accept. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** The RFC 4226 counter (step number) for an instant. */
export function totpStepAt(timeMs: number): number {
  return Math.floor(timeMs / TOTP_STEP_MS);
}

/**
 * RFC 4226 §5.3 HMAC truncation.
 *
 * The counter is written as a big-endian 64-bit integer; `digits` exists so the
 * RFC 6238 vectors can be reproduced exactly (they are published as 8-digit
 * values, and 6-digit codes are the same truncation with the leading digits
 * dropped).
 */
export function hotp(key: Buffer, counter: number | bigint, digits: number = TOTP_DIGITS): string {
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) {
    throw new Error('hotp: digits must be an integer between 6 and 10');
  }

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;

  return String(truncated % 10 ** digits).padStart(digits, '0');
}

/** The code an authenticator app shows at `timeMs`. */
export function totpAt(
  secret: string,
  timeMs: number,
  digits: number = TOTP_DIGITS
): string {
  return hotp(base32Decode(secret), totpStepAt(timeMs), digits);
}

function constantTimeCodeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export interface VerifyTotpOptions {
  /** The instant to check against. Defaults to now. */
  now?: Date | number;
  /** Steps of tolerance either side of the current step. Defaults to ±1. */
  window?: number;
  digits?: number;
}

export interface TotpMatch {
  /** The step number the accepted code belongs to. Persist this, never the code. */
  step: number;
}

/**
 * Find the step a code belongs to, within the allowed window, or `null`.
 *
 * The comparison is constant-time per candidate and every candidate in the
 * window is always evaluated, so the response time does not depend on which
 * step matched (or that none did).
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: VerifyTotpOptions = {}
): TotpMatch | null {
  const digits = options.digits ?? TOTP_DIGITS;
  const window = options.window ?? TOTP_DEFAULT_WINDOW;
  const nowMs = options.now instanceof Date ? options.now.getTime() : (options.now ?? Date.now());

  const candidate = code.replace(/[\s-]/g, '');
  if (candidate.length !== digits || !/^\d+$/.test(candidate)) {
    return null;
  }

  const key = base32Decode(secret);
  const currentStep = totpStepAt(nowMs);
  let matched: number | null = null;

  for (let offset = -window; offset <= window; offset += 1) {
    const step = currentStep + offset;
    if (step < 0) {
      continue;
    }
    const expected = hotp(key, step, digits);
    if (constantTimeCodeEquals(candidate, expected) && matched === null) {
      matched = step;
    }
  }

  return matched === null ? null : { step: matched };
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The issuer and label are what a phone displays in its code list; the secret
 * is repeated in the query because that is what RFC 6238 clients read. Callers
 * must never log the return value — it contains the secret.
 */
export function buildOtpAuthUri(input: {
  secret: string;
  accountName: string;
  issuer?: string;
  digits?: number;
  period?: number;
}): string {
  const issuer = input.issuer ?? 'Time Keeper';
  const digits = input.digits ?? TOTP_DIGITS;
  const period = input.period ?? TOTP_STEP_SECONDS;

  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(input.accountName)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: TOTP_ALGORITHM,
    digits: String(digits),
    period: String(period),
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}
