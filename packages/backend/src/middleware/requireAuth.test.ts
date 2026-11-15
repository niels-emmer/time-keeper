import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { createTestApp } from '../test/harness.js';

/**
 * A4 — `requireAuth` in every `AUTH_MODE`, and `requireAdmin`.
 *
 * The proxy path is exercised through the real app (the 100+ existing tests
 * cover it in detail); these add the new session path, the mode gates, the
 * email -> `users.id` resolution and the 404-not-403 admin rule.
 */

const originalEnv = { ...process.env };

const HEADERS = {
  Host: 'auth-modes.test',
  Origin: 'http://auth-modes.test',
  'X-authentik-email': 'alice@example.com',
};

let app: import('express').Express;
let db: AppDatabase;

beforeEach(async () => {
  process.env = { ...originalEnv };
  delete process.env.AUTH_MODE;
  delete process.env.DEV_USER_ID;
  delete process.env.TRUSTED_PROXY_CIDRS;
  process.env.NODE_ENV = 'test';
  ({ app, db } = await createTestApp());
});

afterEach(() => {
  process.env = { ...originalEnv };
});

async function createSessionFor(email: string): Promise<string> {
  const { seedUser } = await import('../test/harness.js');
  const { createSession } = await import('../lib/session.js');
  const userId = seedUser(db, email);
  return createSession({ userId }).id;
}

describe('proxy mode', () => {
  beforeEach(() => {
    // Phase F: local is now the default, so the proxy path must be requested
    // explicitly here rather than relying on an unset AUTH_MODE.
    process.env.AUTH_MODE = 'proxy';
  });

  it('authenticates the Authentik header as before', async () => {
    const res = await request(app).get('/api/info').set(HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.user).toBe('alice@example.com');
  });

  it('resolves the email to users.id and provisions an account on first sight', async () => {
    const { users } = await import('../db/schema.js');

    await request(app).get('/api/info').set(HEADERS).expect(200);

    const rows = db.select().from(users).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('alice@example.com');
    expect(rows[0].role).toBe('user');
    expect(rows[0].mustSetPassword).toBe(true);
    expect(rows[0].passwordHash).toMatch(/^unusable\$/);
    expect(rows[0].username).toMatch(/^[a-z0-9_-]{3,32}$/);
  });

  it('treats email casing as the same account', async () => {
    await request(app).get('/api/info').set(HEADERS).expect(200);
    await request(app)
      .get('/api/info')
      .set({ ...HEADERS, 'X-authentik-email': 'ALICE@Example.com' })
      .expect(200);

    const { users } = await import('../db/schema.js');
    expect(db.select().from(users).all()).toHaveLength(1);
  });

  it('still rejects a request with no identity at all', async () => {
    const res = await request(app).get('/api/info');
    expect(res.status).toBe(401);
  });

  it('rejects a Bearer token that does not exist, regardless of the header', async () => {
    const res = await request(app)
      .get('/api/info')
      .set({ ...HEADERS, Authorization: 'Bearer not-a-token' });

    expect(res.status).toBe(401);
  });

  it('ignores a session cookie: sessions are not an auth path in proxy mode', async () => {
    const raw = await createSessionFor('alice@example.com');

    const res = await request(app).get('/api/info').set('Cookie', `tk_session=${raw}`);
    expect(res.status).toBe(401);
  });

  it('keeps the DEV_USER_ID bypass available outside production', async () => {
    process.env.DEV_USER_ID = 'dev@example.com';

    const res = await request(app).get('/api/info');

    expect(res.status).toBe(200);
    expect(res.body.user).toBe('dev@example.com');
  });
});

describe('local mode', () => {
  beforeEach(() => {
    process.env.AUTH_MODE = 'local';
  });

  it('ignores the Authentik header', async () => {
    const res = await request(app).get('/api/info').set(HEADERS);
    expect(res.status).toBe(401);
  });

  it('ignores DEV_USER_ID', async () => {
    process.env.DEV_USER_ID = 'dev@example.com';
    const res = await request(app).get('/api/info');
    expect(res.status).toBe(401);
  });

  it('authenticates a session cookie', async () => {
    const raw = await createSessionFor('alice@example.com');

    const res = await request(app).get('/api/info').set('Cookie', `tk_session=${raw}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBe('alice@example.com');
  });

  it('rejects a forged session id', async () => {
    const res = await request(app).get('/api/info').set('Cookie', 'tk_session=made-up');
    expect(res.status).toBe(401);
  });

  it('scopes data to the session user, exactly like the header path did', async () => {
    const raw = await createSessionFor('alice@example.com');
    // Session mutations now also carry the double-submit pair (Phase B).
    const csrf = 'require-auth-csrf-token';
    const cookie = `tk_session=${raw}; tk_csrf=${csrf}`;

    const created = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .set({ Host: 'auth-modes.test', Origin: 'http://auth-modes.test', 'X-CSRF-Token': csrf })
      .send({ name: 'Session project' });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/categories').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.map((row: { name: string }) => row.name)).toContain('Session project');

    // The same account seen through the proxy path in hybrid mode.
    process.env.AUTH_MODE = 'hybrid';
    const viaHeader = await request(app).get('/api/categories').set(HEADERS);
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.body.map((row: { name: string }) => row.name)).toContain('Session project');
  });
});

describe('hybrid mode', () => {
  beforeEach(() => {
    process.env.AUTH_MODE = 'hybrid';
  });

  it('accepts a session and the header', async () => {
    const raw = await createSessionFor('alice@example.com');

    await request(app).get('/api/info').set('Cookie', `tk_session=${raw}`).expect(200);
    await request(app).get('/api/info').set(HEADERS).expect(200);
  });
});

describe('token path', () => {
  beforeEach(() => {
    process.env.AUTH_MODE = 'proxy';
  });

  it('keeps authMethod=token, so token management stays interactive-only', async () => {
    await request(app).get('/api/info').set(HEADERS).expect(200);

    const minted = await request(app)
      .post('/api/tokens')
      .set(HEADERS)
      .send({ label: 'mac' });
    expect(minted.status).toBe(201);

    const rawToken = minted.body.token as string;

    // A token works for data routes…
    const info = await request(app)
      .get('/api/info')
      .set('Authorization', `Bearer ${rawToken}`);
    expect(info.status).toBe(200);
    expect(info.body.user).toBe('alice@example.com');

    // …and cannot mint further tokens.
    const escalated = await request(app)
      .post('/api/tokens')
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ label: 'second' });
    expect(escalated.status).toBe(403);
  });
});

describe('requireAdmin', () => {
  function makeReq(role: 'user' | 'admin'): Request {
    return { userRole: role, userId: 'id', userEmail: 'e@x', authMethod: 'header' } as unknown as Request;
  }

  function makeRes() {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res as Response & { statusCode: number; body: unknown };
  }

  it('lets an admin through', async () => {
    const { requireAdmin } = await import('./auth.js');
    let called = false;
    const next: NextFunction = () => {
      called = true;
    };

    requireAdmin(makeReq('admin'), makeRes(), next);
    expect(called).toBe(true);
  });

  it('returns 404 — not 403 — for a non-admin, so the surface stays undiscoverable', async () => {
    const { requireAdmin } = await import('./auth.js');
    const res = makeRes();
    let called = false;
    const next: NextFunction = () => {
      called = true;
    };

    requireAdmin(makeReq('user'), res, next);

    expect(called).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });
});
