import { describe, expect, it } from 'vitest';
import {
  API_TOKEN_TTL_DAYS,
  createTokenExpiryTimestamp,
  isTokenExpired,
} from './apiTokenExpiry.js';

describe('apiTokenExpiry', () => {
  it('creates a timestamp roughly one year in the future', () => {
    const now = new Date('2026-05-13T12:00:00.000Z');
    const expiresAt = createTokenExpiryTimestamp(now);
    const diffMs = Date.parse(expiresAt) - now.getTime();
    const expectedMs = API_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

    expect(diffMs).toBe(expectedMs);
  });

  it('treats null or undefined expiries as non-expiring', () => {
    expect(isTokenExpired(null)).toBe(false);
    expect(isTokenExpired(undefined)).toBe(false);
  });

  it('treats invalid expiry timestamps as expired', () => {
    expect(isTokenExpired('not-a-date')).toBe(true);
  });

  it('treats past timestamps as expired', () => {
    expect(isTokenExpired('2026-05-12T12:00:00.000Z', new Date('2026-05-13T12:00:00.000Z'))).toBe(true);
  });

  it('treats future timestamps as active', () => {
    expect(isTokenExpired('2026-05-14T12:00:00.000Z', new Date('2026-05-13T12:00:00.000Z'))).toBe(false);
  });
});
