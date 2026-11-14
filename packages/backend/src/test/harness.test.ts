/**
 * Smoke tests for the HTTP harness (finding M-8).
 *
 * These are the first backend tests that go through Express instead of calling
 * Drizzle objects directly. They prove the harness works end to end against a
 * migrated in-memory database: one public route and one authenticated route.
 * Broader route coverage follows in later phases.
 */

import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { authHeaders, createTestApp } from './harness.js';
import type { AppDatabase } from '../db/client.js';

describe('HTTP harness', () => {
  let app: Express;
  let db: AppDatabase;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  it('serves /api/health without authentication', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('rejects an unauthenticated request to an authenticated route', async () => {
    const res = await request(app).get('/api/settings');

    expect(res.status).toBe(401);
  });

  it('serves an authenticated route for the Authentik-header user', async () => {
    const res = await request(app)
      .get('/api/settings')
      .set(authHeaders(db, 'harness@example.com'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weeklyGoalHours: 40, roundingIncrementMinutes: 60, timezone: 'UTC' });
  });

  it('gives each call its own database, even within one test file', async () => {
    const first = await createTestApp();
    await request(first.app)
      .put('/api/settings')
      .set('Host', 'harness.test')
      .set('Origin', 'http://harness.test')
      .set(authHeaders(first.db, 'isolation@example.com'))
      .send({ weeklyGoalHours: 12, roundingIncrementMinutes: 30 })
      .expect(200);

    const second = await createTestApp();
    const res = await request(second.app)
      .get('/api/settings')
      .set('Host', 'harness.test')
      .set('Origin', 'http://harness.test')
      .set(authHeaders(second.db, 'isolation@example.com'));

    // If the second call had reused the first call's module-level db, this
    // would return the 12 h / 30 min row the first app wrote.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weeklyGoalHours: 40, roundingIncrementMinutes: 60, timezone: 'UTC' });
  });
});
