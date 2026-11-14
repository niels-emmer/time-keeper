import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  DUMMY_PASSWORD_HASH,
  KEY_BYTES,
  SALT_BYTES,
  UNUSABLE_PASSWORD_PREFIX,
  createUnusablePasswordHash,
  hashPassword,
  needsRehash,
  timingSafeEqualString,
  verifyPassword,
} from './password.js';

describe('password hashing (A2)', () => {
  const password = 'correct horse battery staple';

  it('round-trips a password', () => {
    const stored = hashPassword(password);
    expect(verifyPassword(password, stored)).toBe(true);
  });

  it('stores a versioned, self-describing scrypt string', () => {
    const stored = hashPassword(password);
    const parts = stored.split('$');

    expect(parts).toHaveLength(7);
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toBe('v1');
    expect(Number(parts[2])).toBe(DEFAULT_PARAMS.N);
    expect(Number(parts[3])).toBe(DEFAULT_PARAMS.r);
    expect(Number(parts[4])).toBe(DEFAULT_PARAMS.p);
    expect(Buffer.from(parts[5], 'base64url')).toHaveLength(SALT_BYTES);
    expect(Buffer.from(parts[6], 'base64url')).toHaveLength(KEY_BYTES);

    // scrypt params live in the string, so they can be raised later.
    expect(DEFAULT_PARAMS).toEqual({ N: 32768, r: 8, p: 1 });
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword(password);
    expect(verifyPassword('correct horse battery stapl', stored)).toBe(false);
    expect(verifyPassword(`${password} `, stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash', () => {
    expect(hashPassword(password)).not.toBe(hashPassword(password));
  });

  it('rejects a tampered prefix instead of throwing', () => {
    const stored = hashPassword(password);
    const tampered = stored.replace(/^scrypt/, 'bcrypt');
    expect(verifyPassword(password, tampered)).toBe(false);
  });

  it('rejects a tampered version', () => {
    const stored = hashPassword(password);
    expect(verifyPassword(password, stored.replace('$v1$', '$v2$'))).toBe(false);
  });

  it('rejects a tampered digest', () => {
    const stored = hashPassword(password);
    const parts = stored.split('$');
    const digest = Buffer.from(parts[6], 'base64url');
    digest[0] ^= 0xff;
    parts[6] = digest.toString('base64url');

    expect(verifyPassword(password, parts.join('$'))).toBe(false);
  });

  it('rejects malformed values without throwing', () => {
    for (const value of [
      '',
      'scrypt',
      'scrypt$v1$32768$8$1',
      'scrypt$v1$notanumber$8$1$c2FsdA$a2V5',
      'scrypt$v1$32768$8$1$!!!notbase64!!!$a2V5',
      'a$b$c$d$e$f$g',
    ]) {
      expect(verifyPassword(password, value)).toBe(false);
    }
  });

  it('refuses out-of-range cost parameters instead of allocating unbounded memory', () => {
    // N below the floor, non-power-of-two N, and an absurd N.
    expect(verifyPassword(password, 'scrypt$v1$2$8$1$c2FsdA$a2V5')).toBe(false);
    expect(verifyPassword(password, 'scrypt$v1$1000$8$1$c2FsdA$a2V5')).toBe(false);
    expect(verifyPassword(password, 'scrypt$v1$2147483648$8$1$c2FsdA$a2V5')).toBe(false);
    expect(verifyPassword(password, 'scrypt$v1$32768$99$1$c2FsdA$a2V5')).toBe(false);
  });

  it('verifies hashes written with other (recorded) parameters', () => {
    const stored = hashPassword(password, { N: 1024, r: 8, p: 1 });
    expect(verifyPassword(password, stored)).toBe(true);
    expect(needsRehash(stored)).toBe(true);
  });

  it('reports when a hash should be upgraded', () => {
    expect(needsRehash(hashPassword(password))).toBe(false);
    expect(needsRehash(hashPassword(password, { N: 4096, r: 8, p: 1 }))).toBe(true);
    expect(needsRehash(createUnusablePasswordHash())).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });

  it('never verifies a migrated account sentinel', () => {
    const unusable = createUnusablePasswordHash();
    expect(unusable.startsWith(UNUSABLE_PASSWORD_PREFIX)).toBe(true);
    expect(verifyPassword('', unusable)).toBe(false);
    expect(verifyPassword(password, unusable)).toBe(false);
  });

  it('never verifies the dummy enumeration hash', () => {
    expect(verifyPassword('', DUMMY_PASSWORD_HASH)).toBe(false);
    expect(verifyPassword('password', DUMMY_PASSWORD_HASH)).toBe(false);
    // It is a real, well-formed scrypt hash — which is the point: the
    // unknown-user path does the same work as the wrong-password path.
    expect(DUMMY_PASSWORD_HASH.startsWith('scrypt$v1$32768$8$1$')).toBe(true);
  });
});

describe('timingSafeEqualString', () => {
  it('reports equality without early exit', () => {
    expect(timingSafeEqualString('same-value', 'same-value')).toBe(true);
    expect(timingSafeEqualString('', '')).toBe(true);
  });

  it('reports inequality', () => {
    expect(timingSafeEqualString('a', 'b')).toBe(false);
    expect(timingSafeEqualString('same-value', 'same-valuE')).toBe(false);
  });

  it('handles different lengths without throwing', () => {
    expect(timingSafeEqualString('short', 'a-much-longer-value')).toBe(false);
    expect(timingSafeEqualString('', 'x')).toBe(false);
  });
});
