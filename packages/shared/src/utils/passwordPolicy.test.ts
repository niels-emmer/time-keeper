import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  checkPasswordPolicy,
  getPasswordPolicyChecks,
} from './passwordPolicy.js';

/**
 * Q22 password policy. The important property for the UI is that
 * `getPasswordPolicyChecks` and `checkPasswordPolicy` agree: a password the
 * checklist shows as fully met must be one the API accepts, and vice versa.
 */

const CONTEXT = { username: 'alice', email: 'alice@example.com' };

describe('checkPasswordPolicy', () => {
  it('requires the minimum length', () => {
    expect(checkPasswordPolicy('short', CONTEXT)).toEqual({
      ok: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
    });
  });

  it('rejects a password containing the username', () => {
    expect(checkPasswordPolicy('xxalicexxxxxx', CONTEXT)).toEqual({
      ok: false,
      message: 'Password must not contain your username.',
    });
  });

  it('rejects a password containing the email local part', () => {
    expect(checkPasswordPolicy('xxalice12345', { username: 'bob', email: 'alice@example.com' })).toEqual({
      ok: false,
      message: 'Password must not contain your email address.',
    });
  });

  it('rejects a password containing the full email address', () => {
    expect(
      checkPasswordPolicy('xxab@example.com', { username: 'bob', email: 'ab@example.com' })
    ).toEqual({
      ok: false,
      message: 'Password must not contain your email address.',
    });
  });

  it('rejects a denylisted password', () => {
    expect(checkPasswordPolicy('password1234', { username: 'bob', email: 'bob@example.com' })).toEqual({
      ok: false,
      message: 'That password is too common. Choose something less predictable.',
    });
  });

  it('rejects a predictable but long password', () => {
    expect(checkPasswordPolicy('aaaaaaaaaaaa', { username: 'bob', email: 'bob@example.com' })).toEqual({
      ok: false,
      message: 'That password is too predictable. Choose something less obvious.',
    });
  });

  it('accepts a long, unrelated password', () => {
    expect(checkPasswordPolicy('Qh7!tundra-pelican', CONTEXT)).toEqual({ ok: true });
  });
});

describe('getPasswordPolicyChecks', () => {
  it('does not tick content rules before anything is typed', () => {
    const checks = getPasswordPolicyChecks('', CONTEXT);
    expect(checks.map((check) => check.met)).toEqual([false, false, false, false]);
  });

  it('renders one rule per API condition', () => {
    const ids = getPasswordPolicyChecks('anything', CONTEXT).map((check) => check.id);
    expect(ids).toEqual(['length', 'username', 'email', 'common']);
  });

  it('ticks every rule for a password the API accepts', () => {
    const password = 'Qh7!tundra-pelican';
    expect(getPasswordPolicyChecks(password, CONTEXT).every((check) => check.met)).toBe(true);
    expect(checkPasswordPolicy(password, CONTEXT)).toEqual({ ok: true });
  });

  it('flags a denylisted password even though it is long enough', () => {
    const checks = getPasswordPolicyChecks('password1234', CONTEXT);
    const common = checks.find((check) => check.id === 'common');
    expect(common?.met).toBe(false);
    expect(checks.filter((check) => !check.met).map((check) => check.id)).toEqual(['common']);
  });

  it('flags a username substring', () => {
    const checks = getPasswordPolicyChecks('xxalicexxxxxx', CONTEXT);
    expect(checks.find((check) => check.id === 'username')?.met).toBe(false);
  });

  it('matches the API for a predictable password', () => {
    const password = 'aaaaaaaaaaaa';
    expect(getPasswordPolicyChecks(password, CONTEXT).every((check) => check.met)).toBe(false);
    expect(checkPasswordPolicy(password, CONTEXT).ok).toBe(false);
  });
});
