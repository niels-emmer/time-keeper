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
import { createTestApp } from './harness.js';

describe('HTTP harness', () => {
  let app: Express;

  beforeAll(async () => {
    ({ app } = await createTestApp());
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
      .set('X-authentik-email', 'harness@example.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weeklyGoalHours: 40, roundingIncrementMinutes: 60 });
  });
});
