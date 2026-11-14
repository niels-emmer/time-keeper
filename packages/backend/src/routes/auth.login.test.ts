import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { hashPassword } from '../lib/password.js';
import { createTestApp } from '../test/harness.js';

/**
 * Phase B — local login, session issuance, logout, status/me, MFA hole and
 * lockout behaviour through the real Express app.
 *
 * Every test runs in `AUTH_MODE=local`: that is the mode this phase makes
 * usable end to end. Proxy mode remains covered exhaustively by the existing
 * suite, which is run under `AUTH_MODE=proxy` as well.
 */

const originalEnv = { ...process.env };

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'alice@example.com';
const USERNAME = 'alice';

let app: Express;
let db: AppDatabase;
let userId: string;

async function seedAccount(options: {
  email: string;
  username: string;
  password: string;
  role?: 'user' | 'admin';
  mfaEnabled?: boolean;
  disabled?: boolean;
  mustSetPassword?: boolean;
}): Promise<string> {
  const { randomUUID } = await import('crypto');
  const { users } = await import('../db/schema.js');
  const id = randomUUID();

  db.insert(users)
    .values({
      id,
      email: options.email.trim().toLowerCase(),
      username: options.username,
      passwordHash: hashPassword(options.password),
      role: options.role ?? 'user',
      mfaEnabled: options.mfaEnabled ?? false,
      disabled: options.disabled ?? false,
      mustSetPassword: options.mustSetPassword ?? false,
    })
    .run();

  return id;
}

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

function cookieNamed(cookies: string[], name: string): string | undefined {
  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

async function login(body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return request(app)
    .post('/api/auth/login')
    .set(extraHeaders)
    .send(body);
}

async function loginAndCookies(
  body: Record<string, unknown> = { username: USERNAME, password: PASSWORD }
): Promise<{ cookie: string; csrf: string; sessionId: string; response: request.Response }> {
  const response = await login(body);
  expect(response.status).toBe(200);
  const cookies = setCookies(response);
  const sessionId = cookieValue(cookies, 'tk_session');
  const csrf = cookieValue(cookies, 'tk_csrf');
  expect(sessionId).toBeTruthy();
  expect(csrf).toBeTruthy();
  return {
    cookie: `tk_session=${sessionId}; tk_csrf=${csrf}`,
    csrf: csrf as string,
    sessionId: sessionId as string,
    response,
  };
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.AUTH_MODE = 'local';
  delete process.env.DEV_USER_ID;
  delete process.env.TRUSTED_PROXY_CIDRS;

  ({ app, db } = await createTestApp());
  userId = await seedAccount({ email: EMAIL, username: USERNAME, password: PASSWORD });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('POST /api/auth/login — success (Q5)', () => {
  it('logs in by username', async () => {
    const response = await login({ username: USERNAME, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.user.email).toBe(EMAIL);
    expect(response.body.user.username).toBe(USERNAME);
    expect(cookieValue(setCookies(response), 'tk_session')).toBeTruthy();
  });

  it('logs in by email', async () => {
    const response = await login({ email: EMAIL, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(EMAIL);
  });

  it('accepts the single identifier field for either form', async () => {
    await expect(login({ identifier: USERNAME, password: PASSWORD })).resolves.toMatchObject({ status: 200 });
    await expect(login({ identifier: EMAIL, password: PASSWORD })).resolves.toMatchObject({ status: 200 });
  });

  it('treats email casing as the same account', async () => {
    const response = await login({ email: 'ALICE@Example.com', password: PASSWORD });
    expect(response.status).toBe(200);
  });
});

describe('POST /api/auth/login — failure parity (§3)', () => {
  function assertSameFailure(response: request.Response): void {
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid username or password' });
    expect(setCookies(response)).toHaveLength(0);
  }

  it('returns the identical body and status for an unknown user and a wrong password', async () => {
    const unknown = await login({ username: 'nobody', password: PASSWORD });
    const wrong = await login({ username: USERNAME, password: 'definitely-wrong' });

    assertSameFailure(unknown);
    assertSameFailure(wrong);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.text).toBe(wrong.text);
  });

  it('spends the same scrypt work on an unknown user (dummy hash)', async () => {
    // The body is the authoritative parity assertion; this guards the
    // structural part — the unknown path must not return before hashing.
    const t0 = performance.now();
    await login({ username: 'nobody-at-all', password: PASSWORD });
    const unknownMs = performance.now() - t0;

    const t1 = performance.now();
    await login({ username: USERNAME, password: 'definitely-wrong' });
    const wrongMs = performance.now() - t1;

    expect(unknownMs).toBeGreaterThan(5);
    expect(wrongMs).toBeGreaterThan(5);
    // Generous bound: both do one scrypt derivation, which dominates.
    expect(Math.max(unknownMs, wrongMs) / Math.min(unknownMs, wrongMs)).toBeLessThan(5);
  });

  it('does not distinguish a disabled account', async () => {
    await seedAccount({
      email: 'disabled@example.com',
      username: 'disabled',
      password: PASSWORD,
      disabled: true,
    });

    assertSameFailure(await login({ username: 'disabled', password: PASSWORD }));
  });

  it('does not log in a must_set_password account', async () => {
    await seedAccount({
      email: 'reset@example.com',
      username: 'resetme',
      password: PASSWORD,
      mustSetPassword: true,
    });

    assertSameFailure(await login({ username: 'resetme', password: PASSWORD }));
  });
});

describe('session cookie flags (D4)', () => {
  it('sets HttpOnly, SameSite=Lax and Path=/ on the session cookie', async () => {
    const response = await login({ username: USERNAME, password: PASSWORD });
    const cookies = setCookies(response);
    const session = cookieNamed(cookies, 'tk_session');

    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    expect(session).toContain('Path=/');
    // Plain HTTP outside production: Secure would stop local login working.
    expect(session).not.toContain('Secure');
  });

  it('marks the session cookie Secure when a trusted proxy reports https', async () => {
    const response = await login(
      { username: USERNAME, password: PASSWORD },
      { 'X-Forwarded-Proto': 'https' }
    );

    expect(cookieNamed(setCookies(response), 'tk_session')).toContain('Secure');
  });

  it('issues the CSRF cookie without HttpOnly so same-origin JS can read it', async () => {
    const response = await login({ username: USERNAME, password: PASSWORD });
    const csrf = cookieNamed(setCookies(response), 'tk_csrf');

    expect(csrf).toBeTruthy();
    expect(csrf).not.toContain('HttpOnly');
    expect(csrf).toContain('SameSite=Lax');
  });
});

describe('session fixation (§3)', () => {
  it('issues a new id and kills the presented session', async () => {
    const { createSession, verifySession } = await import('../lib/session.js');
    const old = createSession({ userId }, db);

    const response = await login(
      { username: USERNAME, password: PASSWORD },
      { Cookie: `tk_session=${old.id}` }
    );

    expect(response.status).toBe(200);
    const newId = cookieValue(setCookies(response), 'tk_session');
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(old.id);
    expect(verifySession(old.id, {}, db)).toBeNull();
    expect(verifySession(newId as string, {}, db)).not.toBeNull();
  });
});

describe('MFA branch (Phase D typed hole)', () => {
  it('returns a challenge state and does not create a session', async () => {
    await seedAccount({
      email: 'mfa@example.com',
      username: 'mfauser',
      password: PASSWORD,
      mfaEnabled: true,
    });

    const response = await login({ username: 'mfauser', password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'mfa_required' });
    expect(setCookies(response)).toHaveLength(0);
  });
});

describe('lockout (Q23)', () => {
  it('locks an account for a minute after five failures', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failure = await login({ username: USERNAME, password: 'wrong' });
      expect(failure.status).toBe(401);
    }

    const locked = await login({ username: USERNAME, password: PASSWORD });

    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBe('60');
    expect(locked.body).toEqual({ error: 'Too many attempts. Try again later.' });
  });

  it('locks an unknown identifier identically, so 429 cannot prove an account exists', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login({ username: 'ghost', password: 'wrong' });
    }

    const locked = await login({ username: 'ghost', password: 'wrong' });
    expect(locked.status).toBe(429);
    expect(locked.body).toEqual({ error: 'Too many attempts. Try again later.' });
  });

  it('binds the username and email aliases to one backoff key', async () => {
    // Five failures by username must also lock the email alias, otherwise an
    // attacker could alternate identifiers to double their attempts.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login({ username: USERNAME, password: 'wrong' });
    }

    const viaEmail = await login({ email: EMAIL, password: PASSWORD });
    expect(viaEmail.status).toBe(429);
  });

  it('applies the per-IP ceiling of ten attempts per minute', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failure = await login({ username: `ghost-${attempt}`, password: 'wrong' });
      expect(failure.status).toBe(401);
    }

    const limited = await login({ username: 'ghost-eleven', password: 'wrong' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('GET /api/auth/status (public)', () => {
  it('reports unauthenticated before login, with the active mode', async () => {
    const response = await request(app).get('/api/auth/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authenticated: false, mode: 'local' });
  });

  it('reports the signed-in user after login', async () => {
    const { cookie } = await loginAndCookies();

    const response = await request(app).get('/api/auth/status').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.authenticated).toBe(true);
    expect(response.body.mode).toBe('local');
    expect(response.body.user.email).toBe(EMAIL);
  });
});

describe('GET /api/auth/me', () => {
  it('returns an allowlisted summary and never the secrets', async () => {
    const { cookie } = await loginAndCookies();

    const response = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.user).sort()).toEqual(
      [
        'createdAt',
        'displayName',
        'email',
        'id',
        'lastLoginAt',
        'mfaEnabled',
        'mustSetPassword',
        'role',
        'username',
      ].sort()
    );

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('password_hash');
    expect(serialized).not.toContain('mfaSecretEnc');
    expect(serialized).not.toContain('mfa_secret_enc');

    const { users } = await import('../db/schema.js');
    const row = db.select().from(users).all()[0];
    expect(serialized).not.toContain(row.passwordHash);
  });

  it('rejects a request with no session', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });
});

describe('logout', () => {
  it('revokes the session immediately', async () => {
    const { cookie, csrf } = await loginAndCookies();

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf);
    expect(logout.status).toBe(204);

    const after = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('logout-all revokes every session for the account', async () => {
    const { cookie, csrf } = await loginAndCookies();
    const { createSession } = await import('../lib/session.js');
    const other = createSession({ userId }, db);

    const logoutAll = await request(app)
      .post('/api/auth/logout-all')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf);
    expect(logoutAll.status).toBe(204);

    const otherAttempt = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `tk_session=${other.id}`);
    expect(otherAttempt.status).toBe(401);

    const ownAttempt = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(ownAttempt.status).toBe(401);
  });
});

describe('AUTH_MODE wiring (D1)', () => {
  it('local mode rejects a request that only carries the identity header', async () => {
    const response = await request(app).get('/api/info').set('X-authentik-email', EMAIL);
    expect(response.status).toBe(401);
  });

  it('proxy mode does not expose the local login endpoint', async () => {
    process.env.AUTH_MODE = 'proxy';

    const response = await login({ username: USERNAME, password: PASSWORD });
    expect(response.status).toBe(404);
  });
});
