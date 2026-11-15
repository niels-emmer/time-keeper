import { describe, expect, it } from 'vitest';
import {
  TOTP_STEP_MS,
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  generateTotpSecret,
  hotp,
  totpAt,
  totpStepAt,
  verifyTotp,
} from './totp.js';

/**
 * RFC 6238 evidence.
 *
 * Appendix B publishes 8-digit SHA-1 codes for the ASCII secret
 * `12345678901234567890`. Reproducing those values exactly is the only thing
 * that proves the HOTP truncation, the counter encoding and the step size are
 * right — a hand-rolled TOTP that is "almost right" would still accept codes at
 * the wrong step for everyone.
 */
const RFC6238_SHA1_SECRET_ASCII = '12345678901234567890';
const RFC6238_SHA1_SECRET_BASE32 = base32Encode(Buffer.from(RFC6238_SHA1_SECRET_ASCII, 'utf8'));

const RFC6238_VECTORS: Array<{ seconds: number; code8: string }> = [
  { seconds: 59, code8: '94287082' },
  { seconds: 1111111109, code8: '07081804' },
  { seconds: 1111111111, code8: '14050471' },
  { seconds: 1234567890, code8: '89005924' },
  { seconds: 2000000000, code8: '69279037' },
  { seconds: 20000000000, code8: '65353130' },
];

describe('RFC 6238 Appendix B vectors (HMAC-SHA1)', () => {
  it('derives the published 20-byte secret as base32', () => {
    expect(RFC6238_SHA1_SECRET_BASE32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC6238_SHA1_SECRET_BASE32).toString('utf8')).toBe(
      RFC6238_SHA1_SECRET_ASCII
    );
  });

  for (const vector of RFC6238_VECTORS) {
    it(`T=${vector.seconds} → ${vector.code8}`, () => {
      const timeMs = vector.seconds * 1000;

      expect(totpAt(RFC6238_SHA1_SECRET_BASE32, timeMs, 8)).toBe(vector.code8);
      // The 6-digit form the app actually uses is the same truncation: the
      // published 8-digit value with its leading two digits dropped.
      expect(totpAt(RFC6238_SHA1_SECRET_BASE32, timeMs)).toBe(vector.code8.slice(2));
    });
  }

  it('steps at exactly the 30-second boundary', () => {
    expect(totpStepAt(0)).toBe(0);
    expect(totpStepAt(TOTP_STEP_MS - 1)).toBe(0);
    expect(totpStepAt(TOTP_STEP_MS)).toBe(1);
    expect(totpStepAt(59_000)).toBe(1);
    expect(totpStepAt(1111111109 * 1000)).toBe(37037036);
  });
});

describe('base32', () => {
  it('round-trips arbitrary bytes without padding', () => {
    const input = Buffer.from([0x00, 0xff, 0x10, 0x42, 0x7f, 0x99, 0xab, 0xcd, 0xef, 0x01]);
    const encoded = base32Encode(input);

    expect(encoded).toMatch(/^[A-Z2-7]+$/);
    expect(encoded).not.toContain('=');
    expect(base32Decode(encoded).equals(input)).toBe(true);
  });

  it('accepts lowercase, spaces, hyphens and trailing padding', () => {
    const expected = base32Decode(RFC6238_SHA1_SECRET_BASE32);
    expect(
      base32Decode('gezd gnbv-gy3tqojq gezdgnbvgy3tqojq==').equals(expected)
    ).toBe(true);
  });

  it('rejects characters outside the alphabet and empty input', () => {
    expect(() => base32Decode('ABC1')).toThrow();
    expect(() => base32Decode('')).toThrow();
  });
});

describe('secret generation', () => {
  it('is 160 bits of base32 (32 characters), different every time', () => {
    const first = generateTotpSecret();
    const second = generateTotpSecret();

    expect(first).toHaveLength(32);
    expect(base32Decode(first)).toHaveLength(20);
    expect(first).not.toBe(second);
  });
});

describe('verifyTotp window and matching', () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const currentStep = totpStepAt(now);

  it('accepts the current step and reports it', () => {
    const code = hotp(base32Decode(secret), currentStep);
    expect(verifyTotp(secret, code, { now })).toEqual({ step: currentStep });
  });

  it('accepts ±1 step for clock skew', () => {
    const previous = hotp(base32Decode(secret), currentStep - 1);
    const next = hotp(base32Decode(secret), currentStep + 1);

    expect(verifyTotp(secret, previous, { now })).toEqual({ step: currentStep - 1 });
    expect(verifyTotp(secret, next, { now })).toEqual({ step: currentStep + 1 });
  });

  it('rejects a code outside the window', () => {
    const tooOld = hotp(base32Decode(secret), currentStep - 2);
    const tooNew = hotp(base32Decode(secret), currentStep + 2);

    expect(verifyTotp(secret, tooOld, { now })).toBeNull();
    expect(verifyTotp(secret, tooNew, { now })).toBeNull();
    expect(verifyTotp(secret, tooOld, { now, window: 2 })).toEqual({ step: currentStep - 2 });
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyTotp(secret, '', { now })).toBeNull();
    expect(verifyTotp(secret, '12345', { now })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { now })).toBeNull();
    expect(verifyTotp(secret, '1234567', { now })).toBeNull();
  });

  it('tolerates spaces in a pasted code', () => {
    const code = hotp(base32Decode(secret), currentStep);
    expect(verifyTotp(secret, ` ${code.slice(0, 3)} ${code.slice(3)} `, { now })).toEqual({
      step: currentStep,
    });
  });
});

describe('buildOtpAuthUri', () => {
  it('produces a scannable URI with the issuer, label and parameters', () => {
    const uri = buildOtpAuthUri({ secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', accountName: 'alice' });

    expect(uri.startsWith('otpauth://totp/Time%20Keeper:alice?')).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get('secret')).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(params.get('issuer')).toBe('Time Keeper');
    expect(params.get('algorithm')).toBe('SHA1');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});
