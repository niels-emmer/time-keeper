import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { authEvents, invites, users } from '../db/schema.js';
import { hashPassword } from '../lib/password.js';
import { createTestApp } from '../test/harness.js';

/**
 * Phase C — invite issuance and registration by invite (D2).
 *
 * The invite token is the only credential, so its lifecycle is the whole
 * security story of self-registration: single use, 72-hour expiry, hashed at
 * rest, and one indistinguishable failure for every bad token.
 */

const originalEnv = { ...process.env };

const ADMIN_PASSWORD = 'admin password for tests';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_USERNAME = 'boss';

const INVITE_PASSWORD = 'a much longer passphrase';

let app: Express;
let db: AppDatabase;
let adminId: string;

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

function seedAccount(options: {
  email: string;
  username: string;
  password: string;
  role?: 'user' | 'admin';
}): string {
  const id = randomUUID();
  db.insert(users)
    .values({
      id,
      email: options.email.toLowerCase(),
      username: options.username,
      passwordHash: hashPassword(options.password),
      role: options.role ?? 'user',
      mustSetPassword: false,
    })
    .run();
  return id;
}

async function signIn(
  username: string,
  password: string
): Promise<{ cookie: string; csrf: string; sessionId: string }> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ username, password });

  expect(response.status).toBe(200);
  const cookies = setCookies(response);
  const sessionId = cookieValue(cookies, 'tk_session') as string;
  const csrf = cookieValue(cookies, 'tk_csrf') as string;

  return { cookie: `tk_session=${sessionId}; tk_csrf=${csrf}`, csrf, sessionId };
}

async function issueInvite(
  body: Record<string, unknown> = {},
  auth: { cookie: string; csrf: string } | null = null
): Promise<request.Response> {
  const session = auth ?? (await signIn(ADMIN_USERNAME, ADMIN_PASSWORD));
  return request(app)
    .post('/api/admin/invites')
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf)
    .send(body);
}

async function acceptInvite(body: Record<string, unknown>): Promise<request.Response> {
  return request(app).post('/api/auth/accept-invite').send(body);
}

function userCount(): number {
  return db.select().from(users).all().length;
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.AUTH_MODE = 'local';
  delete process.env.DEV_USER_ID;
  delete process.env.TRUSTED_PROXY_CIDRS;

  ({ app, db } = await createTestApp());
  adminId = seedAccount({
    email: ADMIN_EMAIL,
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
    role: 'admin',
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('POST /api/admin/invites', () => {
  it('lets an administrator mint a 72-hour single-use invite', async () => {
    const before = Date.now();
    const response = await issueInvite({ email: 'new@example.com' });

    expect(response.status).toBe(201);
    expect(typeof response.body.token).toBe('string');
    expect(response.body.token.length).toBeGreaterThan(20);
    expect(response.body.invite.email).toBe('new@example.com');
    expect(response.body.invite.role).toBe('user');
    expect(response.body.acceptPath).toContain(encodeURIComponent(response.body.token));

    const ttlMs = new Date(response.body.invite.expiresAt).getTime() - before;
    expect(ttlMs).toBeGreaterThan(71 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(72 * 60 * 60 * 1000 + 1000);

    const row = db.select().from(invites).where(eq(invites.id, response.body.invite.id)).get();
    expect(row?.usedAt).toBeNull();
    // Only the hash is stored — never the token that was handed out.
    expect(row?.tokenHash).not.toBe(response.body.token);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers 404 — not 403 — for a non-admin, keeping the surface undiscoverable', async () => {
    seedAccount({ email: 'plain@example.com', username: 'plain', password: ADMIN_PASSWORD });
    const plain = await signIn('plain', ADMIN_PASSWORD);

    const response = await issueInvite({}, plain);

    expect(response.status).toBe(404);
    expect(db.select().from(invites).all()).toHaveLength(0);
  });

  it('requires a session at all', async () => {
    const response = await request(app)
      .post('/api/admin/invites')
      .set('X-CSRF-Token', 'irrelevant')
      .send({});

    expect(response.status).toBe(401);
  });

  it('refuses an invite for an email that already has an account (409)', async () => {
    const response = await issueInvite({ email: ADMIN_EMAIL });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('email_taken');
  });

  it('records an audit event for issuance (Q12)', async () => {
    const response = await issueInvite({});
    expect(response.status).toBe(201);

    const events = db
      .select()
      .from(authEvents)
      .where(eq(authEvents.kind, 'invite_created'))
      .all();

    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe(adminId);
  });
});

describe('POST /api/auth/accept-invite', () => {
  it('creates the account, signs it in and burns the invite', async () => {
    const issued = await issueInvite({ email: 'new@example.com' });
    const token = issued.body.token as string;

    const response = await acceptInvite({
      token,
      email: 'new@example.com',
      username: 'newcomer',
      password: INVITE_PASSWORD,
    });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe('new@example.com');
    expect(response.body.user.username).toBe('newcomer');
    expect(response.body.user.role).toBe('user');
    expect(response.body.user).not.toHaveProperty('passwordHash');

    const cookies = setCookies(response);
    expect(cookieValue(cookies, 'tk_session')).toBeTruthy();
    expect(cookieValue(cookies, 'tk_csrf')).toBeTruthy();

    const row = db.select().from(invites).where(eq(invites.id, issued.body.invite.id)).get();
    expect(row?.usedAt).toBeTruthy();

    const events = db
      .select()
      .from(authEvents)
      .where(eq(authEvents.kind, 'invite_accepted'))
      .all();
    expect(events).toHaveLength(1);

    // The issued session is real: it authenticates a follow-up request.
    const sessionCookie = cookieValue(cookies, 'tk_session') as string;
    const csrf = cookieValue(cookies, 'tk_csrf') as string;
    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `tk_session=${sessionCookie}; tk_csrf=${csrf}`);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('newcomer');
  });

  it('honours the invite role rather than anything the client asks for', async () => {
    const issued = await issueInvite({ role: 'admin' });

    const response = await acceptInvite({
      token: issued.body.token,
      email: 'second-admin@example.com',
      username: 'secondadmin',
      password: INVITE_PASSWORD,
      // A client-supplied role must be ignored.
      role: 'admin',
    });

    expect(response.status).toBe(201);
    const created = db
      .select()
      .from(users)
      .where(eq(users.username, 'secondadmin'))
      .get();
    expect(created?.role).toBe('admin');
  });

  it('is single use', async () => {
    const issued = await issueInvite({});
    const token = issued.body.token as string;

    const first = await acceptInvite({
      token,
      email: 'first@example.com',
      username: 'firstuser',
      password: INVITE_PASSWORD,
    });
    expect(first.status).toBe(201);

    const countAfterFirst = userCount();

    const second = await acceptInvite({
      token,
      email: 'second@example.com',
      username: 'seconduser',
      password: INVITE_PASSWORD,
    });

    expect(second.status).toBe(400);
    expect(userCount()).toBe(countAfterFirst);
  });

  it('rejects an expired invite', async () => {
    const issued = await issueInvite({});
    db.update(invites)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(invites.id, issued.body.invite.id))
      .run();

    const response = await acceptInvite({
      token: issued.body.token,
      email: 'late@example.com',
      username: 'lateuser',
      password: INVITE_PASSWORD,
    });

    expect(response.status).toBe(400);
    expect(db.select().from(users).where(eq(users.username, 'lateuser')).get()).toBeUndefined();
  });

  it('answers used, expired and unknown tokens identically', async () => {
    // used
    const usedInvite = await issueInvite({});
    const accepted = await acceptInvite({
      token: usedInvite.body.token,
      email: 'used@example.com',
      username: 'useduser',
      password: INVITE_PASSWORD,
    });
    expect(accepted.status).toBe(201);
    const used = await acceptInvite({
      token: usedInvite.body.token,
      email: 'used-again@example.com',
      username: 'useduser2',
      password: INVITE_PASSWORD,
    });

    // expired
    const expiredInvite = await issueInvite({});
    db.update(invites)
      .set({ expiresAt: new Date(Date.now() - 1).toISOString() })
      .where(eq(invites.id, expiredInvite.body.invite.id))
      .run();
    const expired = await acceptInvite({
      token: expiredInvite.body.token,
      email: 'expired@example.com',
      username: 'expireduser',
      password: INVITE_PASSWORD,
    });

    // unknown
    const unknown = await acceptInvite({
      token: 'definitely-not-a-real-invite-token',
      email: 'unknown@example.com',
      username: 'unknownuser',
      password: INVITE_PASSWORD,
    });

    for (const response of [used, expired, unknown]) {
      expect(response.status).toBe(400);
    }
    expect(used.body).toEqual(expired.body);
    expect(expired.body).toEqual(unknown.body);
    expect(used.body).toEqual({
      error: 'This invite link is invalid or has expired.',
      code: 'invite_invalid',
    });
  });

  it('enforces the password policy and says why (Q22)', async () => {
    const issued = await issueInvite({});

    const response = await acceptInvite({
      token: issued.body.token,
      email: 'weak@example.com',
      username: 'weakuser',
      password: 'short',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('password_policy');
    expect(response.body.error).toMatch(/at least 12 characters/i);
  });

  it('rejects a password containing the username', async () => {
    const issued = await issueInvite({});

    const response = await acceptInvite({
      token: issued.body.token,
      email: 'substring@example.com',
      username: 'substring',
      password: 'substring-and-more',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/username/i);
  });

  it('rejects a malformed username', async () => {
    const issued = await issueInvite({});

    const response = await acceptInvite({
      token: issued.body.token,
      email: 'caps@example.com',
      username: 'Not Allowed',
      password: INVITE_PASSWORD,
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('username_invalid');
  });

  it('returns 409 — never 500 — when the email is already registered', async () => {
    const issued = await issueInvite({});

    const response = await acceptInvite({
      token: issued.body.token,
      email: ADMIN_EMAIL,
      username: 'anotheruser',
      password: INVITE_PASSWORD,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('email_taken');
  });

  it('returns 409 when the username is already taken', async () => {
    const issued = await issueInvite({});

    const response = await acceptInvite({
      token: issued.body.token,
      email: 'someone-new@example.com',
      username: ADMIN_USERNAME,
      password: INVITE_PASSWORD,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('username_taken');
  });

  it('binds the invite to its email when one was given', async () => {
    const issued = await issueInvite({ email: 'invited@example.com' });

    const wrongEmail = await acceptInvite({
      token: issued.body.token,
      email: 'someone-else@example.com',
      username: 'someoneelse',
      password: INVITE_PASSWORD,
    });

    expect(wrongEmail.status).toBe(400);
    expect(wrongEmail.body.code).toBe('invite_email_mismatch');

    // The mismatch did not consume the invite.
    const rightEmail = await acceptInvite({
      token: issued.body.token,
      email: 'invited@example.com',
      username: 'inviteduser',
      password: INVITE_PASSWORD,
    });
    expect(rightEmail.status).toBe(201);
  });

  it('does not exist in proxy mode, where there is no local session', async () => {
    const issued = await issueInvite({});
    process.env.AUTH_MODE = 'proxy';

    const response = await acceptInvite({
      token: issued.body.token,
      email: 'proxied@example.com',
      username: 'proxieduser',
      password: INVITE_PASSWORD,
    });

    expect(response.status).toBe(404);
  });
});
