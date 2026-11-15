import request from 'supertest';
import type { Express } from 'express';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { base32Decode, hotp, totpStepAt } from '../lib/totp.js';
import { decryptSecret } from '../lib/mfaCrypto.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { createTestApp } from '../test/harness.js';

/**
 * Phase D — TOTP enrolment, challenge completion, recovery codes, disable,
 * regeneration and the Q8 admin gate, exercised through the real Express app in
 * `AUTH_MODE=local`.
 *
 * Time handling: the route layer uses the wall clock, so window boundary cases
 * that need an exact instant are covered by `totp.test.ts` (RFC vectors) and by
 * `mfaService.test.ts` (injected `now`). Everything here is boundary-agnostic —
 * codes are generated for the current step and replay/lockout tests do not
 * depend on where in the 30-second window the test happens to run.
 */

const originalEnv = { ...process.env };

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'mfa-user@example.com';
const USERNAME = 'mfauser';

type Schema = typeof import('../db/schema.js');

let app: Express;
let db: AppDatabase;
let schema: Schema;
let userId: string;

async function seedAccount(options: {
  email: string;
  username: string;
  password: string;
  role?: 'user' | 'admin';
  disabled?: boolean;
}): Promise<string> {
  const { randomUUID } = await import('crypto');
  const id = randomUUID();

  db.insert(schema.users)
    .values({
      id,
      email: options.email.trim().toLowerCase(),
      username: options.username,
      passwordHash: hashPassword(options.password),
      role: options.role ?? 'user',
      disabled: options.disabled ?? false,
      mustSetPassword: false,
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

interface Session {
  cookie: string;
  csrf: string;
  sessionId: string;
}

async function loginWithPassword(
  identifier: string,
  password: string
): Promise<{ response: request.Response; session: Session | null }> {
  const response = await request(app).post('/api/auth/login').send({ identifier, password });

  if (response.status !== 200 || response.body.status !== 'ok') {
    return { response, session: null };
  }

  const cookies = setCookies(response);
  const sessionId = cookieValue(cookies, 'tk_session');
  const csrf = cookieValue(cookies, 'tk_csrf');
  expect(sessionId).toBeTruthy();
  expect(csrf).toBeTruthy();

  return {
    response,
    session: { cookie: `tk_session=${sessionId}; tk_csrf=${csrf}`, csrf: csrf as string, sessionId: sessionId as string },
  };
}

async function requireSession(identifier = USERNAME, password = PASSWORD): Promise<Session> {
  const { response, session } = await loginWithPassword(identifier, password);
  if (!session) {
    throw new Error(`Expected a session, got ${response.status} ${JSON.stringify(response.body)}`);
  }
  return session;
}

function withCsrf(session: Session): Record<string, string> {
  return { Cookie: session.cookie, 'X-CSRF-Token': session.csrf };
}

async function enrol(session: Session) {
  return request(app).post('/api/auth/mfa/enrol').set(withCsrf(session)).send({});
}

function codeFor(secret: string, stepOffset = 0): string {
  return hotp(base32Decode(secret), totpStepAt(Date.now()) + stepOffset);
}

/** Enrol and confirm, returning the secret and the one-time recovery codes. */
async function enrolAndConfirm(session: Session): Promise<{ secret: string; recoveryCodes: string[] }> {
  const enrolled = await enrol(session);
  expect(enrolled.status).toBe(200);

  const confirmed = await request(app)
    .post('/api/auth/mfa/confirm')
    .set(withCsrf(session))
    .send({ code: codeFor(enrolled.body.secret) });

  expect(confirmed.status).toBe(200);
  expect(confirmed.body.recoveryCodes).toHaveLength(10);

  return { secret: enrolled.body.secret, recoveryCodes: confirmed.body.recoveryCodes };
}

async function mfaLogin(identifier: string, password: string, code: string) {
  return request(app).post('/api/auth/login/mfa').send({ identifier, password, code });
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.AUTH_MODE = 'local';
  delete process.env.DEV_USER_ID;
  delete process.env.TRUSTED_PROXY_CIDRS;

  ({ app, db } = await createTestApp());
  schema = await import('../db/schema.js');
  userId = await seedAccount({ email: EMAIL, username: USERNAME, password: PASSWORD });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('POST /api/auth/mfa/enrol', () => {
  it('returns the secret and otpauth URI but activates nothing', async () => {
    const session = await requireSession();

    const response = await enrol(session);

    expect(response.status).toBe(200);
    expect(response.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(response.body.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
    expect(response.body).toMatchObject({ algorithm: 'SHA1', digits: 6, period: 30 });

    const row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    expect(row?.mfaEnabled).toBe(false);
    expect(row?.mfaLastStep).toBeNull();
  });

  it('stores the secret encrypted — the raw column is not the plaintext', async () => {
    const session = await requireSession();
    const response = await enrol(session);
    const secret = response.body.secret as string;

    const row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    const stored = row?.mfaSecretEnc;

    expect(stored).toBeTruthy();
    expect(stored).not.toBe(secret);
    expect(stored).not.toContain(secret);
    expect(stored?.startsWith('v1:')).toBe(true);
    // …and it is genuinely recoverable with the configured key.
    expect(decryptSecret(stored as string)).toBe(secret);
  });

  it('records an auth event and never echoes the secret into it', async () => {
    const session = await requireSession();
    const response = await enrol(session);

    const events = db.select().from(schema.authEvents).all();
    const event = events.find((row) => row.kind === 'mfa_enrol_started');

    expect(event).toBeTruthy();
    expect(event?.metaJson ?? '').not.toContain(response.body.secret);
  });

  it('refuses to re-seed an account that is already enrolled', async () => {
    const session = await requireSession();
    await enrolAndConfirm(session);

    const response = await enrol(session);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('mfa_already_enabled');
  });

  it('refuses a bearer token: enrolment is interactive', async () => {
    const rawToken = 'tk_pat_enrol_test';
    const { createHash } = await import('crypto');
    db.insert(schema.apiTokens)
      .values({
        userId,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        label: 'test',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .run();

    const response = await request(app)
      .post('/api/auth/mfa/enrol')
      .set('Authorization', `Bearer ${rawToken}`)
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('interactive_authentication_required');
  });
});

describe('POST /api/auth/mfa/confirm', () => {
  it('activates MFA only with a valid code, and returns ten recovery codes once', async () => {
    const session = await requireSession();
    const enrolled = await enrol(session);

    const wrong = await request(app)
      .post('/api/auth/mfa/confirm')
      .set(withCsrf(session))
      .send({ code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('mfa_code_invalid');

    let row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    expect(row?.mfaEnabled).toBe(false);

    const confirmed = await request(app)
      .post('/api/auth/mfa/confirm')
      .set(withCsrf(session))
      .send({ code: codeFor(enrolled.body.secret) });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.recoveryCodes).toHaveLength(10);
    for (const code of confirmed.body.recoveryCodes as string[]) {
      expect(code).toMatch(/^[2-9A-Z]{5}-[2-9A-Z]{5}$/);
    }

    row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    expect(row?.mfaEnabled).toBe(true);
    expect(row?.mfaLastStep).toBeTypeOf('number');

    const storedCodes = db.select().from(schema.recoveryCodes).all();
    expect(storedCodes).toHaveLength(10);
    for (const stored of storedCodes) {
      expect(stored.userId).toBe(userId);
      expect(stored.codeHash.startsWith('scrypt$')).toBe(true);
      expect(stored.usedAt).toBeNull();
    }
  });

  it('refuses a code when no enrolment was started', async () => {
    const session = await requireSession();

    const response = await request(app)
      .post('/api/auth/mfa/confirm')
      .set(withCsrf(session))
      .send({ code: '123456' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('mfa_enrolment_not_started');
  });
});

describe('unconfirmed enrolment cannot log in', () => {
  it('still accepts the password alone and refuses the MFA endpoint', async () => {
    const session = await requireSession();
    const enrolled = await enrol(session);
    // Deliberately not confirmed.

    const passwordLogin = await loginWithPassword(USERNAME, PASSWORD);
    expect(passwordLogin.response.status).toBe(200);
    expect(passwordLogin.response.body.status).toBe('ok');
    expect(passwordLogin.session).not.toBeNull();

    const mfa = await mfaLogin(USERNAME, PASSWORD, codeFor(enrolled.body.secret));
    expect(mfa.status).toBe(400);
    expect(mfa.body.code).toBe('mfa_not_enabled');

    const row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    expect(row?.mfaEnabled).toBe(false);
  });
});

describe('POST /api/auth/login/mfa', () => {
  it('challenges an enrolled account and completes with a valid TOTP code', async () => {
    const session = await requireSession();
    const { secret } = await enrolAndConfirm(session);

    const challenge = await request(app)
      .post('/api/auth/login')
      .send({ identifier: USERNAME, password: PASSWORD });

    expect(challenge.status).toBe(200);
    expect(challenge.body).toEqual({ status: 'mfa_required' });
    expect(setCookies(challenge)).toHaveLength(0);

    // The confirmation consumed the current step, so a real second device would
    // use the code shown for the *next* step. Reusing the current one here would
    // be a replay, which the next test asserts is rejected.
    const completed = await mfaLogin(USERNAME, PASSWORD, codeFor(secret, 1));

    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('ok');
    expect(completed.body.user.mfaEnabled).toBe(true);
    expect(completed.body.csrfToken).toBeTruthy();

    const cookies = setCookies(completed);
    expect(cookieValue(cookies, 'tk_session')).toBeTruthy();
    expect(cookieValue(cookies, 'tk_csrf')).toBeTruthy();

    const events = db.select().from(schema.authEvents).all().map((row) => row.kind);
    expect(events).toContain('mfa_code_accepted');
    expect(events).toContain('login_success');
  });

  it('accepts a recovery code and marks it used', async () => {
    const session = await requireSession();
    const { recoveryCodes } = await enrolAndConfirm(session);

    const first = await mfaLogin(USERNAME, PASSWORD, recoveryCodes[0]);
    expect(first.status).toBe(200);

    const used = db
      .select()
      .from(schema.recoveryCodes)
      .all()
      .filter((row) => row.usedAt !== null);
    expect(used).toHaveLength(1);

    // Single use: the same code is worthless a second time.
    const second = await mfaLogin(USERNAME, PASSWORD, recoveryCodes[0]);
    expect(second.status).toBe(401);
    expect(second.body.code).toBe('mfa_code_invalid');

    // …and the remaining nine still work.
    const third = await mfaLogin(USERNAME, PASSWORD, recoveryCodes[1]);
    expect(third.status).toBe(200);
  });

  it('stores recovery codes hashed, never in plaintext', async () => {
    const session = await requireSession();
    const { recoveryCodes } = await enrolAndConfirm(session);
    const plaintext = recoveryCodes[0].replace('-', '');

    const rows = db.select().from(schema.recoveryCodes).all();
    for (const row of rows) {
      expect(row.codeHash).not.toBe(plaintext);
      expect(row.codeHash).not.toContain(plaintext);
      expect(row.codeHash).toMatch(/^scrypt\$v1\$/);
    }

    // Exactly one hash verifies against the plaintext.
    expect(rows.filter((row) => verifyPassword(plaintext, row.codeHash))).toHaveLength(1);
  });

  it('rejects a replayed TOTP code', async () => {
    const session = await requireSession();
    const { secret } = await enrolAndConfirm(session);
    // One step ahead of the step confirmation consumed.
    const code = codeFor(secret, 1);

    const first = await mfaLogin(USERNAME, PASSWORD, code);
    expect(first.status).toBe(200);

    const replay = await mfaLogin(USERNAME, PASSWORD, code);

    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('mfa_code_invalid');

    const events = db.select().from(schema.authEvents).all().map((row) => row.kind);
    expect(events).toContain('mfa_code_replay_rejected');
  });

  it('rejects a wrong password with the same generic answer as /login', async () => {
    const session = await requireSession();
    await enrolAndConfirm(session);

    const response = await mfaLogin(USERNAME, 'not the password', codeFor('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid username or password');
    expect(setCookies(response)).toHaveLength(0);
  });

  it('does not let code guessing lock the password path', async () => {
    const session = await requireSession();
    const { secret } = await enrolAndConfirm(session);

    // Ten wrong codes reach the MFA threshold (not the password threshold).
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const wrong = await mfaLogin(USERNAME, PASSWORD, '000000');
      expect(wrong.status).toBe(401);
    }

    // The password step still works: a code-guessing attacker cannot deny the
    // account owner their own login.
    const passwordLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: USERNAME, password: PASSWORD });
    expect(passwordLogin.status).toBe(200);
    expect(passwordLogin.body).toEqual({ status: 'mfa_required' });

    // There is no password-lockout row for this account.
    const attemptKeys = db.select().from(schema.authAttempts).all().map((row) => row.attemptKey);
    expect(attemptKeys).not.toContain(`acct:user:${userId}`);

    // Online guessing is still throttled: the MFA counter has engaged.
    const guessed = await mfaLogin(USERNAME, PASSWORD, codeFor(secret));
    expect(guessed.status).toBe(429);
  });

  it('reports the challenge as not enabled for an account without MFA', async () => {
    const response = await mfaLogin(USERNAME, PASSWORD, '123456');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('mfa_not_enabled');
    expect(setCookies(response)).toHaveLength(0);
  });

  it('is not reachable in proxy mode', async () => {
    process.env.AUTH_MODE = 'proxy';

    const response = await mfaLogin(USERNAME, PASSWORD, '123456');

    expect(response.status).toBe(404);
  });
});

describe('POST /api/auth/mfa/disable', () => {
  it('requires the password', async () => {
    const session = await requireSession();
    await enrolAndConfirm(session);

    const wrong = await request(app)
      .post('/api/auth/mfa/disable')
      .set(withCsrf(session))
      .send({ password: 'wrong password' });

    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('password_incorrect');

    const row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    expect(row?.mfaEnabled).toBe(true);

    const missing = await request(app)
      .post('/api/auth/mfa/disable')
      .set(withCsrf(session))
      .send({});
    expect(missing.status).toBe(400);
  });

  it('clears the secret and every recovery code, and records the event', async () => {
    const session = await requireSession();
    await enrolAndConfirm(session);

    const response = await request(app)
      .post('/api/auth/mfa/disable')
      .set(withCsrf(session))
      .send({ password: PASSWORD });

    expect(response.status).toBe(204);

    const row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    expect(row?.mfaEnabled).toBe(false);
    expect(row?.mfaSecretEnc).toBeNull();
    expect(row?.mfaLastStep).toBeNull();
    expect(db.select().from(schema.recoveryCodes).all()).toHaveLength(0);

    const events = db.select().from(schema.authEvents).all();
    const event = events.find((entry) => entry.kind === 'mfa_disabled');
    expect(event?.userId).toBe(userId);

    // Password-only login works again.
    const { response: loginResponse } = await loginWithPassword(USERNAME, PASSWORD);
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.status).toBe('ok');
  });

  it('requires a session no older than five minutes (Q17)', async () => {
    const session = await requireSession();
    await enrolAndConfirm(session);

    // Backdate the session: this is what "left open on a laptop" looks like.
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.update(schema.sessions)
      .set({ createdAt: old })
      .where(eq(schema.sessions.userId, userId))
      .run();

    const response = await request(app)
      .post('/api/auth/mfa/disable')
      .set(withCsrf(session))
      .send({ password: PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('reauthentication_required');

    const row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    expect(row?.mfaEnabled).toBe(true);
  });
});

describe('POST /api/auth/mfa/recovery-codes/regenerate', () => {
  it('requires the password and invalidates the old set', async () => {
    const session = await requireSession();
    const { recoveryCodes } = await enrolAndConfirm(session);

    const wrong = await request(app)
      .post('/api/auth/mfa/recovery-codes/regenerate')
      .set(withCsrf(session))
      .send({ password: 'wrong password' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('password_incorrect');

    const regenerated = await request(app)
      .post('/api/auth/mfa/recovery-codes/regenerate')
      .set(withCsrf(session))
      .send({ password: PASSWORD });

    expect(regenerated.status).toBe(200);
    expect(regenerated.body.recoveryCodes).toHaveLength(10);
    expect(regenerated.body.recoveryCodes).not.toContain(recoveryCodes[0]);

    // The old first code is dead; a new one works.
    const oldCode = await mfaLogin(USERNAME, PASSWORD, recoveryCodes[0]);
    expect(oldCode.status).toBe(401);

    const newCode = await mfaLogin(USERNAME, PASSWORD, regenerated.body.recoveryCodes[0]);
    expect(newCode.status).toBe(200);

    const events = db.select().from(schema.authEvents).all().map((row) => row.kind);
    expect(events).toContain('mfa_recovery_codes_regenerated');
    expect(events).toContain('mfa_recovery_code_used');
  });
});

describe('Q8 — administrators without MFA', () => {
  const ADMIN_EMAIL = 'admin-mfa@example.com';
  const ADMIN_USERNAME = 'adminmfa';
  let adminId: string;

  beforeEach(async () => {
    adminId = await seedAccount({
      email: ADMIN_EMAIL,
      username: ADMIN_USERNAME,
      password: PASSWORD,
      role: 'admin',
    });
  });

  it('are refused admin routes with a machine-readable enrolment reason', async () => {
    const session = await requireSession(ADMIN_USERNAME);

    const response = await request(app)
      .post('/api/admin/invites')
      .set(withCsrf(session))
      .send({ role: 'user' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('mfa_enrolment_required');
    expect(db.select().from(schema.invites).all()).toHaveLength(0);
  });

  it('are refused token minting until they enrol', async () => {
    const session = await requireSession(ADMIN_USERNAME);

    const response = await request(app)
      .post('/api/tokens')
      .set(withCsrf(session))
      .send({ label: 'macOS' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('mfa_enrolment_required');
    expect(db.select().from(schema.apiTokens).all()).toHaveLength(0);
  });

  it('can enrol, after which the same admin route works', async () => {
    const session = await requireSession(ADMIN_USERNAME);
    await enrolAndConfirm(session);

    const response = await request(app)
      .post('/api/admin/invites')
      .set(withCsrf(session))
      .send({ role: 'user' });

    expect(response.status).toBe(201);
    expect(response.body.invite.role).toBe('user');
    expect(adminId).toBeTruthy();
  });

  it('leaves a non-admin on 404, so the surface stays undiscoverable', async () => {
    const session = await requireSession();

    const response = await request(app)
      .post('/api/admin/invites')
      .set(withCsrf(session))
      .send({ role: 'user' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not Found' });
  });
});
