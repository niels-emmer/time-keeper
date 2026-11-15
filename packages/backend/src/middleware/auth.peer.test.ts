/**
 * C-1 / P1-2 — the Authentik identity header must only be trusted when the
 * TCP peer is a proxy we control.
 *
 * These tests go through the real Express app (the harness in `src/test`) and
 * simulate the peer address by shadowing `socket.remoteAddress`. That is the
 * value the fix reads, so it reproduces "an attacker on the public internet"
 * and "nginx on the private Docker network" without binding extra sockets.
 */

import { createHash } from 'crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { createTestApp, seedUser } from '../test/harness.js';

const PROXY_SECRET = 'peer-test-secret';
const originalEnv = { ...process.env };

let app: Express;
let db: AppDatabase;

/**
 * Wrap the real app with a middleware that changes the peer address seen by
 * the auth middleware. The real socket keeps serving the response; only the
 * inherited `remoteAddress` getter is shadowed on the instance.
 */
function withPeer(inner: Express, remoteAddress: string): Express {
  const outer = express();
  outer.use((req, _res, next) => {
    Object.defineProperty(req.socket, 'remoteAddress', {
      configurable: true,
      value: remoteAddress,
    });
    next();
  });
  outer.use(inner);
  return outer;
}

function asHeaderUser(req: request.Test, email = 'alice@example.com'): request.Test {
  return req.set('X-authentik-email', email).set('X-Internal-Token', PROXY_SECRET);
}

async function seedToken(rawToken: string, email: string): Promise<void> {
  const { apiTokens } = await import('../db/schema.js');
  db.insert(apiTokens)
    .values({
      userId: seedUser(db, email),
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      label: 'peer-test',
      expiresAt: '2999-01-01T00:00:00.000Z',
    })
    .run();
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

beforeEach(() => {
  // Exercise the production branch: header auth requires the proxy secret.
  process.env.NODE_ENV = 'production';
  process.env.INTERNAL_PROXY_SECRET = PROXY_SECRET;
  delete process.env.TRUSTED_PROXY_CIDRS;
  delete process.env.DEV_USER_ID;
});

afterAll(() => {
  process.env = { ...originalEnv };
});

/**
 * PROXY-ONLY SUITE. These tests exercise the `X-authentik-email` trust boundary
 * (C-1) and its trusted-peer rule, which only exists when `AUTH_MODE` allows
 * proxy headers. Under `AUTH_MODE=local` the header is ignored by design, so
 * this file is skipped rather than pretending the behaviour exists.
 */
// Phase F: the default is local, so "unset" must also skip this proxy-only suite.
const proxyModeSuite = (process.env.AUTH_MODE ?? 'local') === 'local' ? describe.skip : describe;

proxyModeSuite('auth peer allowlist (C-1)', () => {
  it('rejects X-authentik-email from a public peer even with a valid internal token', async () => {
    const res = await asHeaderUser(
      request(withPeer(app, '203.0.113.10')).get('/api/info')
    );

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('accepts X-authentik-email from a private peer and authenticates that email', async () => {
    const res = await asHeaderUser(
      request(withPeer(app, '10.0.0.5')).get('/api/info'),
      'alice@example.com'
    );

    expect(res.status).toBe(200);
    expect(res.body.user).toBe('alice@example.com');
  });

  it('accepts a valid Bearer token from a public peer (Bearer path is unaffected)', async () => {
    const rawToken = 'token-from-public-peer';
    await seedToken(rawToken, 'bearer@example.com');

    const res = await request(withPeer(app, '203.0.113.10'))
      .get('/api/info')
      .set('Authorization', `Bearer ${rawToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBe('bearer@example.com');
  });

  it('treats a missing or blank TRUSTED_PROXY_CIDRS as the loopback/private default', async () => {
    delete process.env.TRUSTED_PROXY_CIDRS;
    let res = await asHeaderUser(request(withPeer(app, '127.0.0.1')).get('/api/info'));
    expect(res.status).toBe(200);

    process.env.TRUSTED_PROXY_CIDRS = '   ';
    res = await asHeaderUser(request(withPeer(app, '10.0.0.5')).get('/api/info'));
    expect(res.status).toBe(200);

    // The default still rejects a public peer.
    res = await asHeaderUser(request(withPeer(app, '203.0.113.10')).get('/api/info'));
    expect(res.status).toBe(401);
  });

  it('honours an explicit TRUSTED_PROXY_CIDRS allowlist entry', async () => {
    process.env.TRUSTED_PROXY_CIDRS = '203.0.113.0/24, 2001:db8::/32';

    const res = await asHeaderUser(request(withPeer(app, '203.0.113.10')).get('/api/info'));

    expect(res.status).toBe(200);
  });

  it('does not let a crafted X-Forwarded-For defeat the peer check', async () => {
    const res = await request(withPeer(app, '203.0.113.10'))
      .get('/api/info')
      .set('X-Forwarded-For', '127.0.0.1, 10.0.0.1')
      .set('X-authentik-email', 'audit@example.com')
      .set('X-Internal-Token', PROXY_SECRET);

    expect(res.status).toBe(401);
  });
});
