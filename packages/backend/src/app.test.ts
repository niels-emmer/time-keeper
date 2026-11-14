/**
 * P1-5 / finding L-1 — /api/health under the rate limiter, real version.
 * P1-6 / finding M-4 — trust proxy depth so req.ip is the real client.
 */

import type { Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { authHeaders, createTestApp } from './test/harness.js';

afterEach(() => {
  delete process.env.APP_VERSION;
});

describe('P1-5: /api/health under the limiter', () => {
  it('reports the same version as /api/info', async () => {
    process.env.APP_VERSION = '9.9.9-test';
    const { app, db } = await createTestApp();

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok', version: '9.9.9-test' });

    const info = await request(app)
      .get('/api/info')
      .set(authHeaders(db, 'p1-5@example.com'));
    expect(info.status).toBe(200);
    expect(info.body.version).toBe('9.9.9-test');
  });

  it('falls back to "dev" when APP_VERSION is unset', async () => {
    delete process.env.APP_VERSION;
    const { app } = await createTestApp();

    const health = await request(app).get('/api/health');
    expect(health.body.version).toBe('dev');
  });

  it('is served while the Docker healthcheck cadence (every 30 s) stays healthy', async () => {
    delete process.env.APP_VERSION;
    const { app } = await createTestApp();

    // One request = one healthcheck tick; nowhere near the 120/min budget.
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('rate-limits 130 rapid health requests with a 429', { timeout: 30_000 }, async () => {
    const { app } = await createTestApp();

    const statuses: number[] = [];
    for (let i = 0; i < 130; i += 1) {
      const res = await request(app).get('/api/health');
      statuses.push(res.status);
    }

    expect(statuses.filter((status) => status === 200)).toHaveLength(120);
    expect(statuses.filter((status) => status === 429)).toHaveLength(10);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});

describe('P1-6: trust proxy depth (two hops: NPM then frontend nginx)', () => {
  async function ipApp(): Promise<Express> {
    const { app } = await createTestApp();
    // Test-only probe for the resolved client address. Added after createApp()
    // so it never ships in production code.
    app.get('/__test-ip', (req, res) => {
      res.json({ ip: req.ip });
    });
    return app;
  }

  it('resolves two distinct X-Forwarded-For chains to distinct req.ip values', async () => {
    const app = await ipApp();

    const first = await request(app)
      .get('/__test-ip')
      .set('X-Forwarded-For', '203.0.113.5, 10.0.0.2');
    const second = await request(app)
      .get('/__test-ip')
      .set('X-Forwarded-For', '198.51.100.7, 10.0.0.2');

    // <client>, <NPM> with socket = frontend nginx; trust=2 lands on <client>.
    expect(first.body.ip).toBe('203.0.113.5');
    expect(second.body.ip).toBe('198.51.100.7');
    expect(first.body.ip).not.toBe(second.body.ip);
  });

  it('ignores a client-supplied leading X-Forwarded-For entry', async () => {
    const app = await ipApp();

    const res = await request(app)
      .get('/__test-ip')
      // Attacker prepends their own value; the two trusted hops bury it.
      .set('X-Forwarded-For', '1.1.1.1, 203.0.113.5, 10.0.0.2');

    expect(res.body.ip).toBe('203.0.113.5');
    expect(res.body.ip).not.toBe('1.1.1.1');
  });
});
