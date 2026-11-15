import { randomUUID } from 'crypto';
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
  passwordResetCodes,
  recoveryCodes,
  sessions,
  timeEntries,
  userSettings,
  users,
} from '../db/schema.js';
import { encryptSecret } from '../lib/mfaCrypto.js';
import { hashPassword } from '../lib/password.js';
import { base32Decode, generateTotpSecret, hotp, totpStepAt } from '../lib/totp.js';
import { createSession } from '../lib/session.js';
import { createTestApp } from '../test/harness.js';

/**
 * Phase E — the admin surface.
 *
 * These tests are the contract for the administrator API and its guards:
 *
 *   * a non-admin gets **404** on every admin route (never 403, so the surface
 *     is undiscoverable);
 *   * an administrator without MFA is refused with the machine-readable
 *     `mfa_enrolment_required` reason;
 *   * the last enabled administrator cannot be demoted, disabled or deleted;
 *   * disabling revokes real, live sessions (no mocks);
 *   * reset codes are single-use, expire, replace the previous code and revoke
 *     sessions;
 *   * both deletion modes leave zero orphans per table;
 *   * every admin mutation writes an audit row with the acting admin as actor.
 *
 * Everything runs under `AUTH_MODE=local`, the mode where local passwords,
 * sessions and admin MFA exist together.
 */

const originalEnv = { ...process.env };

const ADMIN = { email: 'admin@example.com', username: 'boss', password: 'admin password is long' };
const BOB = { email: 'bob@example.com', username: 'bob', password: 'bob password is longer' };

let app: Express;
let db: AppDatabase;
let adminId: string;
let adminTotpSecret: string;
/** One admin session per test: a TOTP code is single-use. */
let adminSession: SignedIn | null = null;

interface SignedIn {
  cookie: string;
  csrf: string;
  sessionId: string;
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

function seedAccount(options: {
  email: string;
  username: string;
  password: string;
  role?: 'user' | 'admin';
  disabled?: boolean;
  /** Q8: an administrator must have MFA enrolled to reach admin routes. */
  mfaSecret?: string;
}): string {
  const id = randomUUID();
  db.insert(users)
    .values({
      id,
      email: options.email.toLowerCase(),
      username: options.username,
      passwordHash: hashPassword(options.password),
      role: options.role ?? 'user',
      disabled: options.disabled ?? false,
      mustSetPassword: false,
      mfaEnabled: Boolean(options.mfaSecret),
      mfaSecretEnc: options.mfaSecret ? encryptSecret(options.mfaSecret) : null,
      mfaLastStep: options.mfaSecret ? 0 : null,
    })
    .run();
  return id;
}

function currentCode(secret: string): string {
  return hotp(base32Decode(secret), totpStepAt(Date.now()));
}

/** Sign in, completing the TOTP step when the account has MFA. */
async function signIn(
  username: string,
  password: string,
  secret?: string
): Promise<SignedIn> {
  let response = await request(app).post('/api/auth/login').send({ username, password });
  expect(response.status).toBe(200);

  if (response.body.status === 'mfa_required') {
    if (!secret) {
      throw new Error('Account requires MFA but no secret was supplied');
    }
    response = await request(app)
      .post('/api/auth/login/mfa')
      .send({ username, password, code: currentCode(secret) });
    expect(response.status).toBe(200);
  }

  const cookies = setCookies(response);
  const sessionId = cookieValue(cookies, 'tk_session') as string;
  const csrf = cookieValue(cookies, 'tk_csrf') as string;
  return { cookie: `tk_session=${sessionId}; tk_csrf=${csrf}`, csrf, sessionId };
}

async function requireAdminSession(): Promise<SignedIn> {
  adminSession ??= await signIn(ADMIN.username, ADMIN.password, adminTotpSecret);
  return adminSession;
}

function adminRequest(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  auth: SignedIn,
  body?: Record<string, unknown>
) {
  const base = request(app)[method](path).set('Cookie', auth.cookie);
  if (method !== 'get') {
    base.set('X-CSRF-Token', auth.csrf);
  }
  return body === undefined ? base : base.send(body);
}

function seedCategory(userId: string, name: string): number {
  return db.insert(categories).values({ userId, name }).returning().get().id;
}

function seedEntry(userId: string, categoryId: number, startTime: string): number {
  return db
    .insert(timeEntries)
    .values({ userId, categoryId, startTime, endTime: startTime })
    .returning()
    .get()
    .id;
}

function seedGoal(userId: string, categoryId: number): void {
  db.insert(monthlyProjectGoals)
    .values({
      userId,
      categoryId,
      monthYear: '2026-01',
      availableHours: 10,
      availableMinutes: 600,
    })
    .run();
}

/** Every table with a `user_id` that must hold no row for a deleted account. */
function countRowsForUser(userId: string): Record<string, number> {
  return {
    timeEntries: db.select().from(timeEntries).where(eq(timeEntries.userId, userId)).all().length,
    monthlyProjectGoals: db
      .select()
      .from(monthlyProjectGoals)
      .where(eq(monthlyProjectGoals.userId, userId))
      .all().length,
    categories: db.select().from(categories).where(eq(categories.userId, userId)).all().length,
    userSettings: db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .all().length,
    apiTokens: db.select().from(apiTokens).where(eq(apiTokens.userId, userId)).all().length,
    recoveryCodes: db
      .select()
      .from(recoveryCodes)
      .where(eq(recoveryCodes.userId, userId))
      .all().length,
    sessions: db.select().from(sessions).where(eq(sessions.userId, userId)).all().length,
    passwordResetCodes: db
      .select()
      .from(passwordResetCodes)
      .where(eq(passwordResetCodes.userId, userId))
      .all().length,
    users: db.select().from(users).where(eq(users.id, userId)).all().length,
  };
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.AUTH_MODE = 'local';
  delete process.env.DEV_USER_ID;
  delete process.env.TRUSTED_PROXY_CIDRS;

  ({ app, db } = await createTestApp());
  adminSession = null;
  adminTotpSecret = generateTotpSecret();
  adminId = seedAccount({
    email: ADMIN.email,
    username: ADMIN.username,
    password: ADMIN.password,
    role: 'admin',
    mfaSecret: adminTotpSecret,
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('admin route guards', () => {
  const ROUTES: Array<['get' | 'post' | 'patch' | 'delete', (id: string) => string]> = [
    ['get', () => '/api/admin/users'],
    ['post', () => '/api/admin/users'],
    ['patch', (id) => `/api/admin/users/${id}`],
    ['delete', (id) => `/api/admin/users/${id}`],
    ['post', (id) => `/api/admin/users/${id}/reset`],
    ['post', () => '/api/admin/invites'],
    ['get', () => '/api/admin/auth-events'],
  ];

  it('answers 404 — never 403 — on every admin route for a non-admin', async () => {
    const bobId = seedAccount(BOB);
    const bob = await signIn(BOB.username, BOB.password);
    const usersBefore = db.select().from(users).all().length;

    for (const [method, path] of ROUTES) {
      const response = await adminRequest(method, path(bobId), bob, {});
      expect({ method, path: path(bobId), status: response.status }).toEqual({
        method,
        path: path(bobId),
        status: 404,
      });
    }

    // Nothing was created or changed by any of the rejected calls.
    expect(db.select().from(users).all()).toHaveLength(usersBefore);
  });

  it('requires a session at all', async () => {
    const response = await request(app).get('/api/admin/users');
    expect(response.status).toBe(401);
  });

  it('refuses an administrator without MFA with the machine-readable enrolment reason', async () => {
    seedAccount({
      email: 'nomfa@example.com',
      username: 'nomfa',
      password: ADMIN.password,
      role: 'admin',
      // no mfaSecret: Q8 requires enrolment before admin features
    });
    const admin = await signIn('nomfa', ADMIN.password);

    const read = await adminRequest('get', '/api/admin/users', admin);
    expect(read.status).toBe(403);
    expect(read.body.code).toBe('mfa_enrolment_required');

    const write = await adminRequest('post', '/api/admin/users', admin, {
      email: 'new@example.com',
      username: 'newuser',
    });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('mfa_enrolment_required');
  });
});

// ---------------------------------------------------------------------------
// Listing and creation
// ---------------------------------------------------------------------------

describe('GET /api/admin/users', () => {
  it('lists accounts with an entry count and never leaks credential material', async () => {
    const bobId = seedAccount(BOB);
    const categoryId = seedCategory(bobId, 'Work');
    seedEntry(bobId, categoryId, '2026-01-05T09:00:00.000Z');
    seedEntry(bobId, categoryId, '2026-01-06T09:00:00.000Z');

    const admin = await requireAdminSession();
    const response = await adminRequest('get', '/api/admin/users', admin);

    expect(response.status).toBe(200);
    const bob = response.body.users.find((user: { id: string }) => user.id === bobId);
    expect(bob).toMatchObject({
      id: bobId,
      email: BOB.email,
      username: BOB.username,
      role: 'user',
      disabled: false,
      mfaEnabled: false,
      entryCount: 2,
    });
    expect(bob).toHaveProperty('createdAt');
    expect(bob).toHaveProperty('lastLoginAt');
    expect(JSON.stringify(response.body)).not.toContain('scrypt$');
    expect(bob).not.toHaveProperty('passwordHash');
    expect(bob).not.toHaveProperty('mfaSecretEnc');
    expect(bob).not.toHaveProperty('mfaLastStep');
  });
});

describe('POST /api/admin/users', () => {
  it('creates an account and returns a 60-minute single-use reset code exactly once', async () => {
    const before = Date.now();
    const admin = await requireAdminSession();

    const response = await adminRequest('post', '/api/admin/users', admin, {
      email: 'new@example.com',
      username: 'newuser',
      role: 'user',
    });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: 'new@example.com',
      username: 'newuser',
      role: 'user',
      mustSetPassword: true,
    });
    expect(typeof response.body.resetCode).toBe('string');
    expect(response.body.resetCode.length).toBeGreaterThan(20);

    const ttlMs = new Date(response.body.resetExpiresAt).getTime() - before;
    expect(ttlMs).toBeGreaterThan(59 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);

    const created = db
      .select()
      .from(users)
      .where(eq(users.email, 'new@example.com'))
      .get();
    expect(created?.mustSetPassword).toBe(true);
    expect(created?.passwordHash.startsWith('unusable$')).toBe(true);

    // The raw code is not stored — only its hash.
    const stored = db.select().from(passwordResetCodes).all();
    expect(stored).toHaveLength(1);
    expect(stored[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0].codeHash).not.toBe(response.body.resetCode);

    // The code gets the new person in and sets their own password.
    const reset = await request(app)
      .post('/api/auth/reset')
      .send({ code: response.body.resetCode, newPassword: 'a fresh passphrase here' });
    expect(reset.status).toBe(204);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'newuser', password: 'a fresh passphrase here' });
    expect(login.status).toBe(200);
    expect(login.body.status).toBe('ok');
  });

  it('answers 409 for a duplicate email and 400 for a reserved username', async () => {
    const admin = await requireAdminSession();

    const duplicate = await adminRequest('post', '/api/admin/users', admin, {
      email: ADMIN.email,
      username: 'someone-else',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('email_taken');

    const reserved = await adminRequest('post', '/api/admin/users', admin, {
      email: 'reserved@example.com',
      username: 'root',
    });
    expect(reserved.status).toBe(400);
    expect(reserved.body.code).toBe('username_invalid');
  });
});

// ---------------------------------------------------------------------------
// Role changes, disable/enable and the last-admin guard
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/users/:id', () => {
  it('cannot demote or disable the last administrator (including yourself)', async () => {
    const admin = await requireAdminSession();

    const demote = await adminRequest('patch', `/api/admin/users/${adminId}`, admin, {
      role: 'user',
    });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe('last_admin');

    const disable = await adminRequest('patch', `/api/admin/users/${adminId}`, admin, {
      disabled: true,
    });
    expect(disable.status).toBe(409);
    expect(disable.body.code).toBe('last_admin');

    const stored = db.select().from(users).where(eq(users.id, adminId)).get();
    expect(stored?.role).toBe('admin');
    expect(stored?.disabled).toBe(false);
  });

  it('allows demoting another administrator when one enabled admin remains', async () => {
    const secondAdminId = seedAccount({
      email: 'second-admin@example.com',
      username: 'secondadmin',
      password: ADMIN.password,
      role: 'admin',
    });
    const admin = await requireAdminSession();

    const response = await adminRequest('patch', `/api/admin/users/${secondAdminId}`, admin, {
      role: 'user',
    });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('user');

    // With only one admin left, that remaining admin is now protected.
    const selfDemote = await adminRequest('patch', `/api/admin/users/${adminId}`, admin, {
      role: 'user',
    });
    expect(selfDemote.status).toBe(409);
    expect(selfDemote.body.code).toBe('last_admin');
  });

  it('disables an account, revokes its live sessions immediately and blocks login', async () => {
    const bobId = seedAccount(BOB);
    const bob = await signIn(BOB.username, BOB.password);

    // The session is real and working before the disable.
    const before = await adminRequest('get', '/api/settings', bob);
    expect(before.status).toBe(200);

    const admin = await requireAdminSession();
    const response = await adminRequest('patch', `/api/admin/users/${bobId}`, admin, {
      disabled: true,
    });
    expect(response.status).toBe(200);
    expect(response.body.user.disabled).toBe(true);

    // The same cookie is now unauthenticated — the session row is gone.
    const after = await adminRequest('get', '/api/settings', bob);
    expect(after.status).toBe(401);
    expect(
      db.select().from(sessions).where(eq(sessions.userId, bobId)).all()
    ).toHaveLength(0);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: BOB.username, password: BOB.password });
    expect(login.status).toBe(401);

    // Re-enabling restores access without a new password.
    const enable = await adminRequest('patch', `/api/admin/users/${bobId}`, admin, {
      disabled: false,
    });
    expect(enable.status).toBe(200);
    expect(enable.body.user.disabled).toBe(false);

    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ username: BOB.username, password: BOB.password });
    expect(relogin.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Reset codes (D5)
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/reset and POST /api/auth/reset', () => {
  it('issues a single-use code that sets a password and revokes live sessions', async () => {
    const bobId = seedAccount(BOB);
    const bob = await signIn(BOB.username, BOB.password);

    const admin = await requireAdminSession();
    const issued = await adminRequest('post', `/api/admin/users/${bobId}/reset`, admin);
    expect(issued.status).toBe(200);
    expect(typeof issued.body.resetCode).toBe('string');

    const reset = await request(app)
      .post('/api/auth/reset')
      .send({ code: issued.body.resetCode, newPassword: 'a much longer passphrase' });
    expect(reset.status).toBe(204);

    // The session that existed before the reset is dead.
    expect((await adminRequest('get', '/api/settings', bob)).status).toBe(401);

    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ username: BOB.username, password: 'a much longer passphrase' });
    expect(relogin.status).toBe(200);

    const stored = db.select().from(users).where(eq(users.id, bobId)).get();
    expect(stored?.mustSetPassword).toBe(false);

    // The same code cannot be used twice, and the failure is generic.
    const replay = await request(app)
      .post('/api/auth/reset')
      .send({ code: issued.body.resetCode, newPassword: 'another passphrase entirely' });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('reset_code_invalid');
  });

  it('expires a code after 60 minutes and answers exactly like an unknown code', async () => {
    const bobId = seedAccount(BOB);
    const admin = await requireAdminSession();
    const issued = await adminRequest('post', `/api/admin/users/${bobId}/reset`, admin);

    db.update(passwordResetCodes)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(passwordResetCodes.userId, bobId))
      .run();

    const expired = await request(app)
      .post('/api/auth/reset')
      .send({ code: issued.body.resetCode, newPassword: 'a brand new passphrase' });
    const unknown = await request(app)
      .post('/api/auth/reset')
      .send({ code: 'not-a-real-code', newPassword: 'a brand new passphrase' });

    expect(expired.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(expired.body).toEqual(unknown.body);
    expect(expired.body.code).toBe('reset_code_invalid');
  });

  it('invalidates the previous code when a new one is issued', async () => {
    const bobId = seedAccount(BOB);
    const admin = await requireAdminSession();

    const first = await adminRequest('post', `/api/admin/users/${bobId}/reset`, admin);
    const second = await adminRequest('post', `/api/admin/users/${bobId}/reset`, admin);
    expect(first.body.resetCode).not.toBe(second.body.resetCode);
    expect(
      db.select().from(passwordResetCodes).where(eq(passwordResetCodes.userId, bobId)).all()
    ).toHaveLength(1);

    const stale = await request(app)
      .post('/api/auth/reset')
      .send({ code: first.body.resetCode, newPassword: 'a brand new passphrase' });
    expect(stale.status).toBe(400);

    const fresh = await request(app)
      .post('/api/auth/reset')
      .send({ code: second.body.resetCode, newPassword: 'a brand new passphrase' });
    expect(fresh.status).toBe(204);
  });

  it('enforces the password policy and leaves the code usable after a rejected attempt', async () => {
    const bobId = seedAccount(BOB);
    const admin = await requireAdminSession();
    const issued = await adminRequest('post', `/api/admin/users/${bobId}/reset`, admin);

    const weak = await request(app)
      .post('/api/auth/reset')
      .send({ code: issued.body.resetCode, newPassword: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('password_policy');

    const ok = await request(app)
      .post('/api/auth/reset')
      .send({ code: issued.body.resetCode, newPassword: 'a properly long passphrase' });
    expect(ok.status).toBe(204);
  });

  it('404s a reset for an account that does not exist', async () => {
    const admin = await requireAdminSession();
    const response = await adminRequest(
      'post',
      `/api/admin/users/${randomUUID()}/reset`,
      admin
    );
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Deletion (Q16)
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/users/:id', () => {
  it('requires an explicit mode', async () => {
    const bobId = seedAccount(BOB);
    const admin = await requireAdminSession();

    const response = await request(app)
      .delete(`/api/admin/users/${bobId}`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .send({});

    expect(response.status).toBe(400);
    expect(db.select().from(users).where(eq(users.id, bobId)).get()).toBeTruthy();
  });

  it('cannot delete the last administrator', async () => {
    const admin = await requireAdminSession();
    const response = await adminRequest('delete', `/api/admin/users/${adminId}`, admin, {
      mode: 'cascade',
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('last_admin');
    expect(db.select().from(users).where(eq(users.id, adminId)).get()).toBeTruthy();
  });

  it('cascade leaves zero orphans in every user-scoped table', async () => {
    const bobId = seedAccount(BOB);
    const categoryId = seedCategory(bobId, 'Work');
    seedEntry(bobId, categoryId, '2026-01-05T09:00:00.000Z');
    seedGoal(bobId, categoryId);
    db.insert(userSettings).values({ userId: bobId }).run();
    db.insert(apiTokens)
      .values({
        userId: bobId,
        tokenHash: 'a'.repeat(64),
        label: 'test',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .run();
    db.insert(recoveryCodes)
      .values({ id: randomUUID(), userId: bobId, codeHash: 'b'.repeat(64) })
      .run();
    createSession({ userId: bobId }, db);

    const admin = await requireAdminSession();
    // A reset code exists too, so the cascade must clear that table as well.
    await adminRequest('post', `/api/admin/users/${bobId}/reset`, admin);

    const response = await adminRequest('delete', `/api/admin/users/${bobId}`, admin, {
      mode: 'cascade',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ deleted: true, mode: 'cascade' });

    expect(countRowsForUser(bobId)).toEqual({
      timeEntries: 0,
      monthlyProjectGoals: 0,
      categories: 0,
      userSettings: 0,
      apiTokens: 0,
      recoveryCodes: 0,
      sessions: 0,
      passwordResetCodes: 0,
      users: 0,
    });
  });

  it('refuses reassign while both accounts have a running timer', async () => {
    const adminCategoryId = seedCategory(adminId, 'Admin work');
    const bobId = seedAccount(BOB);
    const bobCategoryId = seedCategory(bobId, 'Bob work');

    db.insert(timeEntries)
      .values({
        userId: adminId,
        categoryId: adminCategoryId,
        startTime: '2026-01-05T09:00:00.000Z',
        endTime: null,
      })
      .run();
    db.insert(timeEntries)
      .values({
        userId: bobId,
        categoryId: bobCategoryId,
        startTime: '2026-01-05T09:00:00.000Z',
        endTime: null,
      })
      .run();

    const admin = await requireAdminSession();
    const response = await adminRequest('delete', `/api/admin/users/${bobId}`, admin, {
      mode: 'reassign',
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('open_timer_conflict');
    expect(db.select().from(users).where(eq(users.id, bobId)).get()).toBeTruthy();
  });

  it('reassign moves entries and categories to the caller, merging name collisions', async () => {
    // The administrator already owns a "Work" category: moving Bob's identically
    // named category would break the (user_id, name) unique index.
    const adminCategoryId = seedCategory(adminId, 'Work');

    const bobId = seedAccount(BOB);
    const bobWorkId = seedCategory(bobId, 'Work');
    const bobPrivateId = seedCategory(bobId, 'Private');
    seedEntry(bobId, bobWorkId, '2026-01-05T09:00:00.000Z');
    seedEntry(bobId, bobPrivateId, '2026-01-06T09:00:00.000Z');
    seedGoal(bobId, bobPrivateId);
    db.insert(userSettings).values({ userId: bobId }).run();
    db.insert(apiTokens)
      .values({
        userId: bobId,
        tokenHash: 'c'.repeat(64),
        label: 'test',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .run();
    createSession({ userId: bobId }, db);

    const admin = await requireAdminSession();
    const response = await adminRequest('delete', `/api/admin/users/${bobId}`, admin, {
      mode: 'reassign',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      deleted: true,
      mode: 'reassign',
      entriesReassigned: 2,
      categoriesMoved: 1,
      categoriesMerged: 1,
    });

    // The target account has nothing left in any table.
    expect(countRowsForUser(bobId)).toEqual({
      timeEntries: 0,
      monthlyProjectGoals: 0,
      categories: 0,
      userSettings: 0,
      apiTokens: 0,
      recoveryCodes: 0,
      sessions: 0,
      passwordResetCodes: 0,
      users: 0,
    });

    // Both entries now belong to the administrator, and the colliding one
    // points at the administrator's existing "Work" category.
    const movedEntries = db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.userId, adminId))
      .all();
    expect(movedEntries).toHaveLength(2);

    const privateCategory = db
      .select()
      .from(categories)
      .where(eq(categories.name, 'Private'))
      .get();
    expect(privateCategory?.userId).toBe(adminId);
    expect(movedEntries.some((entry) => entry.categoryId === adminCategoryId)).toBe(true);
    expect(
      movedEntries.some((entry) => entry.categoryId === (privateCategory?.id ?? -1))
    ).toBe(true);

    // No dangling category references anywhere.
    const allCategories = db.select().from(categories).all();
    const categoryIds = new Set(allCategories.map((category) => category.id));
    const allEntries = db.select().from(timeEntries).all();
    expect(allEntries.every((entry) => categoryIds.has(entry.categoryId))).toBe(true);
    expect(allCategories.every((category) => category.userId === adminId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Audit viewer (Q12)
// ---------------------------------------------------------------------------

describe('GET /api/admin/auth-events', () => {
  it('records every admin mutation with the acting administrator as the actor', async () => {
    const admin = await requireAdminSession();

    const created = await adminRequest('post', '/api/admin/users', admin, {
      email: 'audited@example.com',
      username: 'audited',
    });
    const createdId = created.body.user.id as string;

    await adminRequest('patch', `/api/admin/users/${createdId}`, admin, {
      role: 'admin',
    });
    await adminRequest('patch', `/api/admin/users/${createdId}`, admin, {
      disabled: true,
    });
    await adminRequest('patch', `/api/admin/users/${createdId}`, admin, {
      disabled: false,
    });
    await adminRequest('post', `/api/admin/users/${createdId}/reset`, admin);
    await adminRequest('post', '/api/admin/invites', admin, { email: 'invited@example.com' });
    await adminRequest('delete', `/api/admin/users/${createdId}`, admin, {
      mode: 'cascade',
    });

    const response = await adminRequest('get', '/api/admin/auth-events?limit=100', admin);
    expect(response.status).toBe(200);

    const kinds = response.body.events.map((event: { kind: string }) => event.kind);
    for (const expected of [
      'user_created',
      'user_role_changed',
      'user_disabled',
      'user_enabled',
      'password_reset_issued',
      'invite_created',
      'user_deleted',
    ]) {
      expect(kinds).toContain(expected);
    }

    for (const event of response.body.events as Array<{
      actor?: { id: string } | null;
      meta?: Record<string, unknown> | null;
    }>) {
      // Only the admin performed mutations here; login events belong to the
      // admin too, so every actor is the admin while that account exists.
      expect(event.actor?.id).toBe(adminId);
    }

    const createdEvent = response.body.events.find(
      (event: { kind: string }) => event.kind === 'user_created'
    );
    expect(createdEvent.meta.targetUserId).toBe(createdId);
  });

  it('paginates newest first', async () => {
    const admin = await requireAdminSession();
    for (let index = 0; index < 3; index += 1) {
      await adminRequest('post', '/api/admin/invites', admin, {
        email: `invite-${index}@example.com`,
      });
    }

    const page = await adminRequest('get', '/api/admin/auth-events?page=1&limit=2', admin);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ page: 1, limit: 2 });
    expect(page.body.events).toHaveLength(2);
    expect(page.body.total).toBeGreaterThanOrEqual(3);
    expect(page.body.hasMore).toBe(true);
  });

  it('prunes audit rows older than 90 days', async () => {
    db.insert(authEvents)
      .values({
        kind: 'ancient_event',
        createdAt: '2020-01-01 00:00:00',
      })
      .run();
    db.insert(authEvents)
      .values({ kind: 'recent_event' })
      .run();

    const admin = await requireAdminSession();
    const response = await adminRequest('get', '/api/admin/auth-events', admin);

    expect(response.status).toBe(200);
    const kinds = response.body.events.map((event: { kind: string }) => event.kind);
    expect(kinds).toContain('recent_event');
    expect(kinds).not.toContain('ancient_event');
  });
});
