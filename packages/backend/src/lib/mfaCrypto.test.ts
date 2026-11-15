import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './mfaCrypto.js';
import { generateTotpSecret } from './totp.js';

/**
 * AES-256-GCM storage for TOTP secrets (D3/Q-D3).
 *
 * The assertions here are the ones that matter if this code is ever changed:
 * the plaintext must not appear in the stored value, a fresh IV must be used per
 * record, and a modified ciphertext or tag must fail rather than decrypt to
 * garbage.
 */
describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', () => {
    const secret = generateTotpSecret();
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('stores nothing resembling the plaintext', () => {
    const secret = generateTotpSecret();
    const stored = encryptSecret(secret);

    expect(stored).not.toContain(secret);
    expect(stored.startsWith('v1:')).toBe(true);
    // version + iv + tag + ciphertext, nothing else
    expect(stored.split(':')).toHaveLength(4);
  });

  it('uses a unique IV for every record, so identical plaintexts differ', () => {
    const secret = generateTotpSecret();
    const first = encryptSecret(secret);
    const second = encryptSecret(secret);

    expect(first).not.toBe(second);

    const [prefix, ivA] = first.split(':');
    const [, ivB] = second.split(':');
    expect(prefix).toBe('v1');
    expect(ivA).not.toBe(ivB);
    expect(Buffer.from(ivA, 'base64url')).toHaveLength(12);
  });

  it('rejects a tampered ciphertext (the auth tag is verified)', () => {
    const stored = encryptSecret(generateTotpSecret());
    const [version, iv, tag, ciphertext] = stored.split(':');

    const tampered = Buffer.from(ciphertext, 'base64url');
    tampered[0] ^= 0x01;

    expect(decryptSecret([version, iv, tag, tampered.toString('base64url')].join(':'))).toBeNull();
  });

  it('rejects a tampered tag', () => {
    const stored = encryptSecret(generateTotpSecret());
    const [version, iv, tag, ciphertext] = stored.split(':');

    const tamperedTag = Buffer.from(tag, 'base64url');
    tamperedTag[0] ^= 0x01;

    expect(
      decryptSecret(
        [version, iv, tamperedTag.toString('base64url'), ciphertext].join(':')
      )
    ).toBeNull();
  });

  it('returns null for malformed values instead of throwing', () => {
    expect(decryptSecret('')).toBeNull();
    expect(decryptSecret('not-a-ciphertext')).toBeNull();
    expect(decryptSecret('v1:onlythree:parts')).toBeNull();
    expect(decryptSecret('v2:a:b:c')).toBeNull();
    expect(decryptSecret(`v1:${randomBytes(12).toString('base64url')}:AAAA:AAAA`)).toBeNull();
  });
});
