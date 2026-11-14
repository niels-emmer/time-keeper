import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { hashPassword } from '../lib/password.js';
import { createTestApp } from '../test/harness.js';

/**
 * D4 — CSRF double-submit, enforced centrally and therefore on every mutating
 * router. This file deliberately proves it on two unrelated routers
 * (`/api/categories` and `/api/settings`) so a future per-route regression is
 * caught before it becomes a hole.
 */

const originalEnv = { ...process.env };
const PASSWORD = 'correct horse battery staple';
const EMAIL = 'csrf@example.com';
const USERNAME = 'csrfuser';

let app: Express;
let db: AppDatabase;

function setCookies(response: request.Response): string[] {
  const header = response.headers['set-cookie'];
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

function cookieValue(cookies: string[], name: string): string | undefined {
  for (const cookie of cookies) {
    const pair = cookie.split(';')[0];
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1);
    }
  }
  return undefined;
}

async function signIn(): Promise<{ sessionId: string; csrf: string; sessionCookie: string }> {
  const { randomUUID } = await import('crypto');
  const { users } = await import('../db/schema.js');

  db.insert(users)
    .values({
      id: randomUUID(),
      email: EMAIL,
      username: USERNAME,
      passwordHash: hashPassword(PASSWORD),
      mustSetPassword: false,
    })
    .run();

  const response = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });

  expect(response.status).toBe(200);
  const cookies = setCookies(response);
  const sessionId = cookieValue(cookies, 'tk_session') as string;
  const csrf = cookieValue(cookies, 'tk_csrf') as string;
  expect(sessionId).toBeTruthy();
  expect(csrf).toBeTruthy();

  return { sessionId, csrf, sessionCookie: `tk_session=${sessionId}` };
}

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

describe('CSRF on /api/categories', () => {
  it('rejects a mutating request with no CSRF token', async () => {
    const { sessionCookie } = await signIn();

    const response = await request(app)
      .post('/api/categories')
      .set('Cookie', sessionCookie)
      .send({ name: 'should not exist' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invalid CSRF token' });
  });

  it('rejects a wrong CSRF token', async () => {
    const { sessionId } = await signIn();

    const response = await request(app)
      .post('/api/categories')
      .set('Cookie', `tk_session=${sessionId}; tk_csrf=the-cookie-value`)
      .set('X-CSRF-Token', 'a-different-header-value')
      .send({ name: 'should not exist either' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invalid CSRF token' });
  });

  it('accepts the matching double-submit pair', async () => {
    const { sessionId, csrf } = await signIn();

    const response = await request(app)
      .post('/api/categories')
      .set('Cookie', `tk_session=${sessionId}; tk_csrf=${csrf}`)
      .set('X-CSRF-Token', csrf)
      .send({ name: 'allowed project' });

    expect(response.status).toBe(201);
  });
});

describe('CSRF on /api/settings (second router)', () => {
  it('rejects a mutating request with no CSRF token', async () => {
    const { sessionCookie } = await signIn();

    const response = await request(app)
      .put('/api/settings')
      .set('Cookie', sessionCookie)
      .send({ weeklyGoalHours: 20, roundingIncrementMinutes: 30 });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invalid CSRF token' });
  });

  it('rejects a wrong CSRF token', async () => {
    const { sessionId } = await signIn();

    const response = await request(app)
      .put('/api/settings')
      .set('Cookie', `tk_session=${sessionId}; tk_csrf=one`)
      .set('X-CSRF-Token', 'two')
      .send({ weeklyGoalHours: 20, roundingIncrementMinutes: 30 });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invalid CSRF token' });
  });

  it('accepts the matching double-submit pair', async () => {
    const { sessionId, csrf } = await signIn();

    const response = await request(app)
      .put('/api/settings')
      .set('Cookie', `tk_session=${sessionId}; tk_csrf=${csrf}`)
      .set('X-CSRF-Token', csrf)
      .send({ weeklyGoalHours: 20, roundingIncrementMinutes: 30 });

    expect(response.status).toBe(200);
    expect(response.body.weeklyGoalHours).toBe(20);
  });
});

describe('CSRF exemptions', () => {
  it('does not require a token on safe methods', async () => {
    const { sessionCookie } = await signIn();

    const response = await request(app).get('/api/categories').set('Cookie', sessionCookie);
    expect(response.status).toBe(200);
  });

  it('does not require a token on the public login endpoint', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: USERNAME, password: PASSWORD });

    // No account yet in this test, but the point is that CSRF did not 403 it.
    expect(response.status).toBe(401);
  });
});
