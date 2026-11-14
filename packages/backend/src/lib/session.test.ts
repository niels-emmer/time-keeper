import { createHash } from 'crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { createTestApp, seedUser } from '../test/harness.js';

/**
 * Session core (A3): opaque id, SHA-256 only at rest, 14-day idle / 90-day
 * absolute expiry (Q7), rotation on privilege change, immediate revocation,
 * and cookie attributes asserted explicitly.
 */

const originalEnv = { ...process.env };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let db: AppDatabase;
let session: typeof import('./session.js');

beforeEach(async () => {
  process.env = { ...originalEnv };
  delete process.env.TRUSTED_PROXY_CIDRS;
  ({ db } = await createTestApp());
  session = await import('./session.js');
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('session storage', () => {
  it('stores only the SHA-256 of the session id', async () => {
    const userId = seedUser(db, 'alice@example.com');
    const created = session.createSession({ userId });

    const row = db.select().from((await import('../db/schema.js')).sessions).get();

    expect(created.id).toHaveLength(43); // 32 random bytes, base64url
    expect(row?.idHash).toBe(createHash('sha256').update(created.id).digest('hex'));
    expect(row?.idHash).not.toBe(created.id);
    expect(JSON.stringify(row)).not.toContain(created.id);
  });

  it('verifies a live session and returns its user', async () => {
    const userId = seedUser(db, 'alice@example.com');
    const created = session.createSession({ userId });

    const verified = session.verifySession(created.id);

    expect(verified?.user.id).toBe(userId);
    expect(verified?.user.email).toBe('alice@example.com');
  });

  it('rejects an unknown id', () => {
    expect(session.verifySession('not-a-real-session')).toBeNull();
  });

  it('rejects and deletes a session past its 14-day idle window', async () => {
    const userId = seedUser(db, 'alice@example.com');
    const now = new Date('2026-04-01T09:00:00.000Z');
    const created = session.createSession({ userId, now });

    // 14 days of silence is the idle limit — the session is gone, not merely
    // refused, so it cannot come back if the clock moves.
    const verified = session.verifySession(created.id, { now: new Date(now.getTime() + 14 * DAY + 1) });
    expect(verified).toBeNull();

    const { sessions } = await import('../db/schema.js');
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it('still accepts a session just inside the idle window', async () => {
    const userId = seedUser(db, 'alice@example.com');
    const now = new Date('2026-04-01T09:00:00.000Z');
    const created = session.createSession({ userId, now });

    expect(session.verifySession(created.id, { now: new Date(now.getTime() + 13 * DAY) })).not.toBeNull();
  });

  it('slides the idle window on use', async () => {
    const userId = seedUser(db, 'alice@example.com');
    const now = new Date('2026-04-01T09:00:00.000Z');
    const created = session.createSession({ userId, now });

    // Use it on day 10, then day 20: still valid because the window slides.
    const dayTen = new Date(now.getTime() + 10 * DAY);
    expect(session.verifySession(created.id, { now: dayTen })).not.toBeNull();
    const dayTwenty = new Date(now.getTime() + 20 * DAY);
    expect(session.verifySession(created.id, { now: dayTwenty })).not.toBeNull();

    // But never past the 90-day absolute cap.
    const dayNinetyOne = new Date(now.getTime() + 91 * DAY);
    expect(session.verifySession(created.id, { now: dayNinetyOne })).toBeNull();
  });

  it('rejects and deletes the session of a disabled account', async () => {
    const userId = seedUser(db, 'alice@example.com');
    const created = session.createSession({ userId });

    const { users, sessions } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    db.update(users).set({ disabled: true }).where(eq(users.id, userId)).run();

    expect(session.verifySession(created.id)).toBeNull();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it('rejects a revoked session immediately', async () => {
    const userId = seedUser(db, 'alice@example.com');
    const created = session.createSession({ userId });

    session.revokeSession(created.id);

    expect(session.verifySession(created.id)).toBeNull();
  });

  it('rotates to a new id and kills the presented one', async () => {
    const userId = seedUser(db, 'alice@example.com');
    const created = session.createSession({ userId });

    const rotated = session.rotateSession(created.id);

    expect(rotated).not.toBeNull();
    expect(rotated?.id).not.toBe(created.id);
    expect(rotated?.userId).toBe(userId);
    expect(session.verifySession(created.id)).toBeNull();
    expect(session.verifySession(rotated!.id)).not.toBeNull();
  });

  it('revokes every session but the caller’s own', async () => {
    const userId = seedUser(db, 'alice@example.com');
    const keep = session.createSession({ userId });
    session.createSession({ userId });
    session.createSession({ userId });

    const otherUser = seedUser(db, 'bob@example.com');
    const untouched = session.createSession({ userId: otherUser });

    const revoked = session.revokeAllSessions(userId, { exceptRawId: keep.id });

    expect(revoked).toBe(2);
    expect(session.verifySession(keep.id)).not.toBeNull();
    expect(session.verifySession(untouched.id)).not.toBeNull();
  });
});

describe('session cookie', () => {
  function cookieApp() {
    return (async () => {
      const app = express();
      app.get('/set', (req, res) => {
        session.setSessionCookie(res, req, 'raw-session-id');
        res.json({ ok: true });
      });
      app.get('/clear', (req, res) => {
        session.clearSessionCookie(res, req);
        res.json({ ok: true });
      });
      return app;
    })();
  }

  function setCookieHeader(response: request.Response): string {
    const header = response.headers['set-cookie'];
    const values = (Array.isArray(header) ? header : [header]).filter(Boolean) as string[];
    expect(values).toHaveLength(1);
    return values[0];
  }

  it('sets HttpOnly, SameSite=Lax, Path=/ and the 90-day max age', async () => {
    const app = await cookieApp();
    const res = await request(app).get('/set');
    const cookie = setCookieHeader(res);

    expect(cookie).toContain('tk_session=raw-session-id');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`Max-Age=${90 * 24 * 60 * 60}`);
    // Not Secure outside production over plain HTTP, or local dev could not log in.
    expect(cookie).not.toContain('Secure');
  });

  it('marks the cookie Secure when a trusted proxy reports https', async () => {
    const app = await cookieApp();
    const res = await request(app).get('/set').set('X-Forwarded-Proto', 'https');
    expect(setCookieHeader(res)).toContain('Secure');
  });

  it('ignores X-Forwarded-Proto from an untrusted peer', async () => {
    const app = await cookieApp();
    const outer = express();
    outer.use((req, _res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', {
        configurable: true,
        value: '203.0.113.10',
      });
      next();
    });
    outer.use(app);

    const res = await request(outer).get('/set').set('X-Forwarded-Proto', 'https');
    expect(setCookieHeader(res)).not.toContain('Secure');
  });

  it('is always Secure in production, even without the forwarded header', async () => {
    process.env.NODE_ENV = 'production';
    const app = await cookieApp();
    const res = await request(app).get('/set');
    expect(setCookieHeader(res)).toContain('Secure');
  });

  it('clears the cookie with the same path and attributes', async () => {
    const app = await cookieApp();
    const cookie = setCookieHeader(await request(app).get('/clear'));

    expect(cookie).toContain('tk_session=');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
  });

  it('reads its own cookie out of a Cookie header with other cookies present', async () => {
    const req = {
      headers: { cookie: 'theme=dark; tk_session=abc123; other=1' },
    } as unknown as express.Request;

    expect(session.readSessionCookie(req)).toBe('abc123');
    expect(session.readSessionCookie({ headers: {} } as unknown as express.Request)).toBeUndefined();
  });
});
