import { createHash } from 'crypto';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { hashPassword } from '../lib/password.js';
import { createTestApp } from '../test/harness.js';

/**
 * Q9 / I-009 under local auth.
 *
 * Before Phase B, token management was gated on `authMethod === 'header'`,
 * which cannot work in `AUTH_MODE=local`. The replacement accepts a session
 * only while it is fresh (Q17, five minutes), keeps the proxy header path
 * working, and still refuses a Bearer token outright.
 */

const originalEnv = { ...process.env };
const PASSWORD = 'correct horse battery staple';
const EMAIL = 'tokens@example.com';
const USERNAME = 'tokenuser';

let app: Express;
let db: AppDatabase;
let userId: string;

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

async function seedToken(rawToken: string): Promise<void> {
  const { apiTokens } = await import('../db/schema.js');
  db.insert(apiTokens)
    .values({
      userId,
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      label: 'existing',
      expiresAt: '2999-01-01T00:00:00.000Z',
    })
    .run();
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.AUTH_MODE = 'local';
  delete process.env.DEV_USER_ID;
  delete process.env.TRUSTED_PROXY_CIDRS;

  ({ app, db } = await createTestApp());

  const { randomUUID } = await import('crypto');
  const { users } = await import('../db/schema.js');
  userId = randomUUID();
  db.insert(users)
    .values({
      id: userId,
      email: EMAIL,
      username: USERNAME,
      passwordHash: hashPassword(PASSWORD),
      mustSetPassword: false,
    })
    .run();
});

afterEach(() => {
  process.env = { ...originalEnv };
});

async function login(): Promise<{ cookie: string; csrf: string }> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });

  expect(response.status).toBe(200);
  const cookies = setCookies(response);
  const sessionId = cookieValue(cookies, 'tk_session') as string;
  const csrf = cookieValue(cookies, 'tk_csrf') as string;
  return { cookie: `tk_session=${sessionId}; tk_csrf=${csrf}`, csrf };
}

describe('token management under local auth (Q9)', () => {
  it('lets a freshly authenticated session mint a token', async () => {
    const { cookie, csrf } = await login();

    const response = await request(app)
      .post('/api/tokens')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ label: 'macOS app' });

    expect(response.status).toBe(201);
    expect(typeof response.body.token).toBe('string');
  });

  it('lets a freshly authenticated session list tokens', async () => {
    const { cookie } = await login();

    const response = await request(app).get('/api/tokens').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('refuses a session older than five minutes with a re-auth code (Q17)', async () => {
    const { createSession } = await import('../lib/session.js');
    const stale = createSession(
      { userId, now: new Date(Date.now() - 10 * 60 * 1000) },
      db
    );
    const csrf = 'stale-session-csrf';

    const response = await request(app)
      .post('/api/tokens')
      .set('Cookie', `tk_session=${stale.id}; tk_csrf=${csrf}`)
      .set('X-CSRF-Token', csrf)
      .send({ label: 'should not be created' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'Re-authentication required',
      code: 'reauthentication_required',
    });
  });

  it('still refuses a Bearer token, so a machine credential cannot mint another', async () => {
    const rawToken = 'existing-machine-token';
    await seedToken(rawToken);

    const response = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ label: 'escalated' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'Token management requires interactive (browser) authentication',
    });
  });

  it('keeps the proxy header path working in proxy mode', async () => {
    process.env.AUTH_MODE = 'proxy';

    const response = await request(app)
      .post('/api/tokens')
      .set('Host', 'tokens.test')
      .set('Origin', 'http://tokens.test')
      .set('X-authentik-email', EMAIL)
      .send({ label: 'proxy browser' });

    expect(response.status).toBe(201);
  });
});
