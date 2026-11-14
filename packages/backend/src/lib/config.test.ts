import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTH_MODE,
  MIN_SESSION_SECRET_LENGTH,
  getAuthMode,
  validateStartupConfig,
} from './config.js';

/**
 * A5 — startup configuration validation.
 *
 * Production must refuse to boot without the secrets the auth subsystem needs;
 * development must generate ephemeral ones and say so loudly.
 */

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...values } as NodeJS.ProcessEnv;
}

const VALID_MFA_KEY = Buffer.alloc(32, 7).toString('base64');
const SESSION_SECRET = 'x'.repeat(MIN_SESSION_SECRET_LENGTH);

describe('getAuthMode', () => {
  it('defaults to proxy for Phase A', () => {
    expect(getAuthMode(env({}))).toBe('proxy');
    expect(DEFAULT_AUTH_MODE).toBe('proxy');
  });

  it('accepts the three known modes, case-insensitively', () => {
    expect(getAuthMode(env({ AUTH_MODE: 'local' }))).toBe('local');
    expect(getAuthMode(env({ AUTH_MODE: 'proxy' }))).toBe('proxy');
    expect(getAuthMode(env({ AUTH_MODE: 'Hybrid' }))).toBe('hybrid');
  });

  it('rejects an unknown mode instead of silently falling back', () => {
    expect(() => getAuthMode(env({ AUTH_MODE: 'both' }))).toThrow(/AUTH_MODE must be one of/);
  });
});

describe('validateStartupConfig — production', () => {
  const base = {
    NODE_ENV: 'production',
    INTERNAL_PROXY_SECRET: 'proxy-secret',
    SESSION_SECRET,
    MFA_ENCRYPTION_KEY: VALID_MFA_KEY,
  };

  it('accepts a complete configuration', () => {
    const result = validateStartupConfig(env(base));

    expect(result.authMode).toBe('proxy');
    expect(result.sessionSecret).toBe(SESSION_SECRET);
    expect(result.mfaEncryptionKey).toHaveLength(32);
  });

  it('accepts a 64-character hex MFA key', () => {
    const hex = Buffer.alloc(32, 3).toString('hex');
    const result = validateStartupConfig(env({ ...base, MFA_ENCRYPTION_KEY: hex }));
    expect(result.mfaEncryptionKey).toHaveLength(32);
  });

  it('refuses to boot without SESSION_SECRET', () => {
    expect(() => validateStartupConfig(env({ ...base, SESSION_SECRET: undefined }))).toThrow(
      /SESSION_SECRET must be set in production/
    );
  });

  it('refuses to boot with a short SESSION_SECRET', () => {
    expect(() => validateStartupConfig(env({ ...base, SESSION_SECRET: 'too-short' }))).toThrow(
      /SESSION_SECRET must be set in production/
    );
  });

  it('refuses to boot without MFA_ENCRYPTION_KEY', () => {
    expect(() => validateStartupConfig(env({ ...base, MFA_ENCRYPTION_KEY: undefined }))).toThrow(
      /MFA_ENCRYPTION_KEY must be set in production/
    );
  });

  it('refuses to boot with an MFA key of the wrong length', () => {
    expect(() =>
      validateStartupConfig(env({ ...base, MFA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }))
    ).toThrow(/32 bytes/);
  });

  it('requires INTERNAL_PROXY_SECRET only when the proxy path is reachable', () => {
    expect(() =>
      validateStartupConfig(env({ ...base, INTERNAL_PROXY_SECRET: undefined }))
    ).toThrow(/INTERNAL_PROXY_SECRET/);

    // A local-only deployment has no proxy in front of it.
    const local = validateStartupConfig(
      env({ ...base, AUTH_MODE: 'local', INTERNAL_PROXY_SECRET: undefined })
    );
    expect(local.authMode).toBe('local');
  });

  it('reports every problem at once', () => {
    expect(() => validateStartupConfig(env({ NODE_ENV: 'production' }))).toThrow(
      /INTERNAL_PROXY_SECRET[\s\S]*SESSION_SECRET[\s\S]*MFA_ENCRYPTION_KEY/
    );
  });
});

describe('validateStartupConfig — development', () => {
  it('generates ephemeral secrets and warns loudly', () => {
    const target = env({ NODE_ENV: 'development' });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string) => warnings.push(String(message));

    try {
      const result = validateStartupConfig(target);

      expect(result.sessionSecret.length).toBeGreaterThanOrEqual(MIN_SESSION_SECRET_LENGTH);
      expect(result.mfaEncryptionKey).toHaveLength(32);
      expect(warnings.join('\n')).toMatch(/NOT FOR PRODUCTION/);
      expect(warnings.join('\n')).toMatch(/SESSION_SECRET/);
      expect(warnings.join('\n')).toMatch(/MFA_ENCRYPTION_KEY/);

      // Written back, so later modules see the same value.
      expect(target.SESSION_SECRET).toBe(result.sessionSecret);
      expect(target.MFA_ENCRYPTION_KEY).toBeTruthy();
    } finally {
      console.warn = originalWarn;
    }
  });

  it('keeps explicitly configured secrets', () => {
    const target = env({
      NODE_ENV: 'development',
      SESSION_SECRET,
      MFA_ENCRYPTION_KEY: VALID_MFA_KEY,
    });

    const result = validateStartupConfig(target);

    expect(result.sessionSecret).toBe(SESSION_SECRET);
    expect(result.mfaEncryptionKey.toString('base64')).toBe(VALID_MFA_KEY);
  });

  it('stays quiet under test', () => {
    const target = env({ NODE_ENV: 'test' });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string) => warnings.push(String(message));

    try {
      validateStartupConfig(target);
      expect(warnings).toHaveLength(0);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('replaces a malformed development MFA key', () => {
    const target = env({ NODE_ENV: 'test', MFA_ENCRYPTION_KEY: 'not-a-key' });
    const result = validateStartupConfig(target);
    expect(result.mfaEncryptionKey).toHaveLength(32);
  });
});
