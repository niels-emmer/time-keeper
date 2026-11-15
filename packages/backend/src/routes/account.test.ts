import { createHash, randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import {
  apiTokens,
  authEvents,
  categories,
  monthlyProjectGoals,
  recoveryCodes,
  sessions,
  timeEntries,
  userSettings,
  users,
} from '../db/schema.js';
import { hashPassword } from '../lib/password.js';
import { createTestApp } from '../test/harness.js';

/**
 * Phase C — self-service account lifecycle.
 *
 * These tests are the contract for the four ways a signed-in person can change
 * their own account: profile, password, sessions and deletion. They pin the
 * guards that matter most — immutable username, 409 on a taken email, session
 * invalidation after a password change, a hard cascade with no orphan rows, and
 * the last-administrator block.
 */

const originalEnv = { ...process.env };

const ALICE = { email: 'alice@example.com', username: 'alice', password: 'alice password is long' };
const BOB = { email: 'bob@example.com', username: 'bob', password: 'bob password is longer' };

let app: Express;
let db: AppDatabase;
let aliceId: string;
let bobId: string;

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

function sessionHandle(rawSessionId: string): string {
  return createHash('sha256').update(rawSessionId, 'utf8').digest('hex');
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

interface SignedIn {
  cookie: string;
  csrf: string;
  sessionId: string;
}

async function signIn(
  username: string = ALICE.username,
  password: string = ALICE.password
): Promise<SignedIn> {
  const response = await request(app).post('/api/auth/login').send({ username, password });
  expect(response.status).toBe(200);

  const cookies = setCookies(response);
  const sessionId = cookieValue(cookies, 'tk_session') as string;
  const csrf = cookieValue(cookies, 'tk_csrf') as string;

  return { cookie: `tk_session=${sessionId}; tk_csrf=${csrf}`, csrf, sessionId };
}

function authGet(path: string, auth: SignedIn) {
  return request(app).get(path).set('Cookie', auth.cookie);
}

function authMutation(
  method: 'post' | 'patch' | 'delete',
  path: string,
  auth: SignedIn,
  body: Record<string, unknown> = {}
) {
  return request(app)
    [method](path)
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send(body);
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.AUTH_MODE = 'local';
  delete process.env.DEV_USER_ID;
  delete process.env.TRUSTED_PROXY_CIDRS;

  ({ app, db } = await createTestApp());
  aliceId = seedAccount(ALICE);
  bobId = seedAccount(BOB);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('PATCH /api/auth/me — profile', () => {
  it('updates the display name and records an audit event', async () => {
    const alice = await signIn();

    const response = await authMutation('patch', '/api/auth/me', alice, {
      displayName: 'Alice A.',
    });

    expect(response.status).toBe(200);
    expect(response.body.user.displayName).toBe('Alice A.');

    const row = db.select().from(users).where(eq(users.id, aliceId)).get();
    expect(row?.displayName).toBe('Alice A.');

    const events = db
      .select()
      .from(authEvents)
      .where(eq(authEvents.kind, 'profile_update'))
      .all();
    expect(events).toHaveLength(1);
  });

  it('rejects any attempt to change the username instead of silently ignoring it (Q14)', async () => {
    const alice = await signIn();

    const attempted = await authMutation('patch', '/api/auth/me', alice, {
      username: 'alice-renamed',
    });
    expect(attempted.status).toBe(400);
    expect(attempted.body.code).toBe('username_immutable');

    // Sending the current value back is also a rejection: the field is not
    // part of this contract at all.
    const unchanged = await authMutation('patch', '/api/auth/me', alice, {
      username: ALICE.username,
      displayName: 'Alice',
    });
    expect(unchanged.status).toBe(400);
    expect(unchanged.body.code).toBe('username_immutable');

    const row = db.select().from(users).where(eq(users.id, aliceId)).get();
    expect(row?.username).toBe(ALICE.username);
    expect(row?.displayName).toBeNull();
  });

  it('returns 409 — never 500 — when the email belongs to someone else (Q15)', async () => {
    const alice = await signIn();

    const response = await authMutation('patch', '/api/auth/me', alice, {
      email: BOB.email,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('email_taken');

    const row = db.select().from(users).where(eq(users.id, aliceId)).get();
    expect(row?.email).toBe(ALICE.email);
  });

  it('changes the email and audits it, keeping login-by-email working', async () => {
    const alice = await signIn();

    const response = await authMutation('patch', '/api/auth/me', alice, {
      email: 'Alice.New@Example.com',
    });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('alice.new@example.com');

    const events = db
      .select()
      .from(authEvents)
      .where(eq(authEvents.kind, 'email_change'))
      .all();
    expect(events).toHaveLength(1);

    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice.new@example.com', password: ALICE.password });
    expect(relogin.status).toBe(200);
  });

  it('requires a session and a CSRF token', async () => {
    const anonymous = await request(app)
      .patch('/api/auth/me')
      .send({ displayName: 'nobody' });
    expect(anonymous.status).toBe(401);

    const alice = await signIn();
    const noCsrf = await request(app)
      .patch('/api/auth/me')
      .set('Cookie', alice.cookie)
      .send({ displayName: 'Alice' });
    expect(noCsrf.status).toBe(403);
  });
});

describe('POST /api/auth/password — change password', () => {
  async function seedCompanionSession(): Promise<SignedIn> {
    // A second device, signed in before the change.
    return signIn();
  }

  it('revokes every other session, keeps the caller signed in and rotates its id', async () => {
    const first = await signIn();
    const second = await signIn();

    const response = await authMutation('post', '/api/auth/password', first, {
      currentPassword: ALICE.password,
      newPassword: 'an entirely different passphrase',
    });

    expect(response.status).toBe(200);
    expect(response.body.otherSessionsRevoked).toBe(1);

    // The presented id is replaced, not reused (session fixation).
    const rotated = cookieValue(setCookies(response), 'tk_session');
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(first.sessionId);

    // The old id is dead, the companion device is dead, the new one works.
    expect((await authGet('/api/auth/me', first)).status).toBe(401);
    expect((await authGet('/api/auth/me', second)).status).toBe(401);

    const rotatedAuth: SignedIn = {
      cookie: `tk_session=${rotated}; tk_csrf=${first.csrf}`,
      csrf: first.csrf,
      sessionId: rotated as string,
    };
    expect((await authGet('/api/auth/me', rotatedAuth)).status).toBe(200);

    // Only one session row survives, and it belongs to alice.
    const remaining = db.select().from(sessions).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(aliceId);

    const events = db
      .select()
      .from(authEvents)
      .where(eq(authEvents.kind, 'password_change'))
      .all();
    expect(events).toHaveLength(1);

    // And the new password is the one that works.
    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ username: ALICE.username, password: 'an entirely different passphrase' });
    expect(relogin.status).toBe(200);
  });

  it('rejects a wrong current password without touching any session', async () => {
    const first = await signIn();
    const second = await seedCompanionSession();

    const response = await authMutation('post', '/api/auth/password', first, {
      currentPassword: 'not the current password',
      newPassword: 'an entirely different passphrase',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('password_incorrect');
    expect(db.select().from(sessions).all()).toHaveLength(2);
    expect((await authGet('/api/auth/me', second)).status).toBe(200);
  });

  it('enforces the policy and leaves the old password working', async () => {
    const alice = await signIn();

    const response = await authMutation('post', '/api/auth/password', alice, {
      currentPassword: ALICE.password,
      newPassword: 'short',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('password_policy');

    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ username: ALICE.username, password: ALICE.password });
    expect(relogin.status).toBe(200);
  });

  it('refuses a session older than five minutes (Q17)', async () => {
    const { createSession } = await import('../lib/session.js');
    const stale = createSession({
      userId: aliceId,
      now: new Date(Date.now() - 6 * 60 * 1000),
    });
    const csrf = 'csrf-token';
    const staleAuth: SignedIn = {
      cookie: `tk_session=${stale.id}; tk_csrf=${csrf}`,
      csrf,
      sessionId: stale.id,
    };

    const response = await authMutation('post', '/api/auth/password', staleAuth, {
      currentPassword: ALICE.password,
      newPassword: 'an entirely different passphrase',
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('reauthentication_required');

    // The password itself is unchanged.
    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ username: ALICE.username, password: ALICE.password });
    expect(relogin.status).toBe(200);
  });

  it('refuses a stale session minting an API token too (Q17)', async () => {
    const { createSession } = await import('../lib/session.js');
    const stale = createSession({
      userId: aliceId,
      now: new Date(Date.now() - 6 * 60 * 1000),
    });
    const csrf = 'csrf-token';

    const response = await request(app)
      .post('/api/tokens')
      .set('Cookie', `tk_session=${stale.id}; tk_csrf=${csrf}`)
      .set('X-CSRF-Token', csrf)
      .send({ label: 'macOS app' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('reauthentication_required');
    expect(db.select().from(apiTokens).all()).toHaveLength(0);
  });

  it('refuses a machine credential outright', async () => {
    db.insert(apiTokens)
      .values({
        userId: aliceId,
        tokenHash: createHash('sha256').update('raw-token').digest('hex'),
        label: 'macOS app',
        expiresAt: '2999-01-01T00:00:00.000Z',
      })
      .run();

    const response = await request(app)
      .post('/api/auth/password')
      .set('Authorization', 'Bearer raw-token')
      .send({
        currentPassword: ALICE.password,
        newPassword: 'an entirely different passphrase',
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('interactive_authentication_required');
  });

  it('refuses a password with no usable hash (migrated account)', async () => {
    db.update(users)
      .set({ mustSetPassword: true, passwordHash: 'unusable$abcdef' })
      .where(eq(users.id, bobId))
      .run();

    // Bob cannot log in any more, so drive the route with a session for alice
    // whose account is swapped for the sentinel.
    const alice = await signIn();
    db.update(users)
      .set({ mustSetPassword: true, passwordHash: 'unusable$abcdef' })
      .where(eq(users.id, aliceId))
      .run();

    const response = await authMutation('post', '/api/auth/password', alice, {
      currentPassword: ALICE.password,
      newPassword: 'an entirely different passphrase',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('password_not_set');
  });
});

describe('GET /api/auth/sessions — signed-in devices', () => {
  it('lists only your own sessions and marks the current one', async () => {
    const aliceFirst = await signIn();
    const aliceSecond = await signIn();
    const bob = await signIn(BOB.username, BOB.password);

    const response = await authGet('/api/auth/sessions', aliceFirst);

    expect(response.status).toBe(200);
    const listed = response.body.sessions as Array<{ id: string; current: boolean }>;
    expect(listed).toHaveLength(2);

    const aliceHashes = [sessionHandle(aliceFirst.sessionId), sessionHandle(aliceSecond.sessionId)];
    expect(listed.map((row) => row.id).sort()).toEqual(aliceHashes.sort());
    expect(listed.filter((row) => row.current)).toHaveLength(1);
    expect(listed.find((row) => row.current)?.id).toBe(sessionHandle(aliceFirst.sessionId));

    // Bob's session is never exposed to alice.
    expect(listed.map((row) => row.id)).not.toContain(sessionHandle(bob.sessionId));
  });

  it('signs out other devices and leaves this one and other accounts alone', async () => {
    const aliceFirst = await signIn();
    const aliceSecond = await signIn();
    const bob = await signIn(BOB.username, BOB.password);

    const response = await authMutation('delete', '/api/auth/sessions/others', aliceFirst);

    expect(response.status).toBe(200);
    expect(response.body.revoked).toBe(1);

    expect((await authGet('/api/auth/me', aliceFirst)).status).toBe(200);
    expect((await authGet('/api/auth/me', aliceSecond)).status).toBe(401);
    expect((await authGet('/api/auth/me', bob)).status).toBe(200);

    const events = db
      .select()
      .from(authEvents)
      .where(eq(authEvents.kind, 'session_revoked'))
      .all();
    expect(events).toHaveLength(1);
  });

  it('404s on another account’s session id, and does not revoke it (Q11)', async () => {
    const alice = await signIn();
    const bob = await signIn(BOB.username, BOB.password);

    const response = await authMutation(
      'delete',
      `/api/auth/sessions/${sessionHandle(bob.sessionId)}`,
      alice
    );

    expect(response.status).toBe(404);
    expect((await authGet('/api/auth/me', bob)).status).toBe(200);
  });

  it('revokes one of your own sessions by id', async () => {
    const aliceFirst = await signIn();
    const aliceSecond = await signIn();

    const response = await authMutation(
      'delete',
      `/api/auth/sessions/${sessionHandle(aliceSecond.sessionId)}`,
      aliceFirst
    );

    expect(response.status).toBe(204);
    expect((await authGet('/api/auth/me', aliceSecond)).status).toBe(401);
    expect((await authGet('/api/auth/me', aliceFirst)).status).toBe(200);
  });
});

describe('DELETE /api/auth/me — self-delete', () => {
  function seedOwnedData(userId: string): number {
    const category = db
      .insert(categories)
      .values({ userId, name: 'Work' })
      .returning()
      .get();

    db.insert(timeEntries)
      .values({
        userId,
        categoryId: category.id,
        startTime: '2026-01-05T09:00:00.000Z',
        endTime: '2026-01-05T10:00:00.000Z',
      })
      .run();

    db.insert(monthlyProjectGoals)
      .values({
        userId,
        categoryId: category.id,
        monthYear: '2026-01',
        availableHours: 10,
        availableMinutes: 600,
      })
      .run();

    db.insert(userSettings).values({ userId }).run();

    db.insert(apiTokens)
      .values({
        userId,
        tokenHash: createHash('sha256').update(`token-${userId}`).digest('hex'),
        label: 'macOS app',
        expiresAt: '2999-01-01T00:00:00.000Z',
      })
      .run();

    db.insert(recoveryCodes)
      .values({ id: randomUUID(), userId, codeHash: 'hash' })
      .run();

    return category.id;
  }

  it('cascades every user-scoped table and leaves zero orphans (Q16)', async () => {
    const alice = await signIn();
    seedOwnedData(aliceId);
    seedOwnedData(bobId);

    const response = await authMutation('delete', '/api/auth/me', alice, {
      password: ALICE.password,
      confirmUsername: ALICE.username,
    });

    expect(response.status).toBe(204);

    // Asserted per table, not just "the user row is gone".
    expect(db.select().from(timeEntries).all().filter((r) => r.userId === aliceId)).toHaveLength(0);
    expect(
      db.select().from(monthlyProjectGoals).all().filter((r) => r.userId === aliceId)
    ).toHaveLength(0);
    expect(db.select().from(categories).all().filter((r) => r.userId === aliceId)).toHaveLength(0);
    expect(db.select().from(userSettings).all().filter((r) => r.userId === aliceId)).toHaveLength(0);
    expect(db.select().from(apiTokens).all().filter((r) => r.userId === aliceId)).toHaveLength(0);
    expect(db.select().from(recoveryCodes).all().filter((r) => r.userId === aliceId)).toHaveLength(0);
    expect(db.select().from(sessions).all().filter((r) => r.userId === aliceId)).toHaveLength(0);
    expect(db.select().from(users).where(eq(users.id, aliceId)).get()).toBeUndefined();

    // Bob's data is untouched.
    expect(db.select().from(users).where(eq(users.id, bobId)).get()).toBeTruthy();
    expect(db.select().from(categories).all().filter((r) => r.userId === bobId)).toHaveLength(1);
    expect(db.select().from(timeEntries).all().filter((r) => r.userId === bobId)).toHaveLength(1);

    // The audit row survives the account (Q12).
    const events = db
      .select()
      .from(authEvents)
      .where(eq(authEvents.kind, 'account_deleted'))
      .all();
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe(aliceId);

    // The revoked session cannot be used again.
    expect((await authGet('/api/auth/me', alice)).status).toBe(401);
  });

  it('requires the typed username to match', async () => {
    const alice = await signIn();

    const response = await authMutation('delete', '/api/auth/me', alice, {
      password: ALICE.password,
      confirmUsername: 'not-alice',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('confirm_mismatch');
    expect(db.select().from(users).where(eq(users.id, aliceId)).get()).toBeTruthy();
  });

  it('requires the password', async () => {
    const alice = await signIn();

    const response = await authMutation('delete', '/api/auth/me', alice, {
      password: 'wrong password entirely',
      confirmUsername: ALICE.username,
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('password_incorrect');
    expect(db.select().from(users).where(eq(users.id, aliceId)).get()).toBeTruthy();
  });

  it('refuses a stale session', async () => {
    const { createSession } = await import('../lib/session.js');
    const stale = createSession({
      userId: aliceId,
      now: new Date(Date.now() - 6 * 60 * 1000),
    });

    const response = await request(app)
      .delete('/api/auth/me')
      .set('Cookie', `tk_session=${stale.id}; tk_csrf=x`)
      .set('X-CSRF-Token', 'x')
      .send({ password: ALICE.password, confirmUsername: ALICE.username });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('reauthentication_required');
    expect(db.select().from(users).where(eq(users.id, aliceId)).get()).toBeTruthy();
  });

  it('blocks the last administrator from deleting themselves', async () => {
    db.update(users).set({ role: 'admin' }).where(eq(users.id, aliceId)).run();
    const alice = await signIn();

    const response = await authMutation('delete', '/api/auth/me', alice, {
      password: ALICE.password,
      confirmUsername: ALICE.username,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('last_admin');
    expect(db.select().from(users).where(eq(users.id, aliceId)).get()).toBeTruthy();
  });

  it('lets an administrator delete themselves when another admin exists', async () => {
    db.update(users).set({ role: 'admin' }).where(eq(users.id, aliceId)).run();
    db.update(users).set({ role: 'admin' }).where(eq(users.id, bobId)).run();
    const alice = await signIn();

    const response = await authMutation('delete', '/api/auth/me', alice, {
      password: ALICE.password,
      confirmUsername: ALICE.username,
    });

    expect(response.status).toBe(204);
    expect(db.select().from(users).where(eq(users.id, aliceId)).get()).toBeUndefined();
  });
});
