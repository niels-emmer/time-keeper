import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { createTestApp } from '../test/harness.js';

/**
 * Dedicated per-IP limits on the two public credential-redemption endpoints
 * (review finding): `POST /api/auth/accept-invite` and `POST /api/auth/reset`
 * used to sit only on the general 120/min `/api` budget, which does not bound
 * guessing. Both now have their own 10-per-15-minute bucket in `auth_attempts`,
 * in the same style as the login limits.
 */

const originalEnv = { ...process.env };

const VALID_INVITE_BODY = {
  token: 'not-a-real-token',
  email: 'someone@example.com',
  username: 'someone',
  password: 'a long enough passphrase',
};

const VALID_RESET_BODY = {
  code: 'not-a-real-code',
  newPassword: 'a long enough passphrase',
};

let app: Express;
let db: AppDatabase;

beforeEach(async () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.AUTH_MODE = 'local';
  delete process.env.DEV_USER_ID;
  delete process.env.TRUSTED_PROXY_CIDRS;

  ({ app, db } = await createTestApp());
});

afterEach(() => {
  process.env = { ...originalEnv };
});

async function attemptInvite() {
  return request(app).post('/api/auth/accept-invite').send(VALID_INVITE_BODY);
}

async function attemptReset() {
  return request(app).post('/api/auth/reset').send(VALID_RESET_BODY);
}

describe('POST /api/auth/accept-invite rate limit', () => {
  it('answers 429 with Retry-After after ten attempts from one address', async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await attemptInvite();
      // A bad token is a 400, and it still counts against the bucket.
      expect(response.status).toBe(400);
    }

    const blocked = await attemptInvite();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many attempts/i);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('POST /api/auth/reset rate limit', () => {
  it('answers 429 with Retry-After after ten attempts from one address', async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await attemptReset();
      expect(response.status).toBe(400);
    }

    const blocked = await attemptReset();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many attempts/i);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('buckets are independent', () => {
  it('does not let invite attempts exhaust the reset bucket', async () => {
    for (let i = 0; i < 11; i += 1) {
      await attemptInvite();
    }

    const reset = await attemptReset();
    expect(reset.status).toBe(400);
  });
});
