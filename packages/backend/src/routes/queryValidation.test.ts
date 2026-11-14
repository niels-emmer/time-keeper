/**
 * P1-4 / findings L-2 and L-3 — unvalidated `week` and `month` query params.
 *
 * `isoWeekBounds()` parses its input with `parseInt`, so `?week=garbage`
 * used to reach it as `NaN` and throw a 500. `?month=2026-13` passed the loose
 * `YYYY-MM` regex and was handled as a real month. Both must be 400s now, and
 * valid values must keep working.
 */

import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { authHeaders, createTestApp } from '../test/harness.js';

const USER = 'query-validation@example.com';

describe('query validation (P1-4)', () => {
  let app: Express;
  let db: AppDatabase;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  function headers() {
    return authHeaders(db, USER);
  }

  it('rejects ?week=garbage on GET /api/entries with 400', async () => {
    const res = await request(app)
      .get('/api/entries?week=garbage')
      .set(headers());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.issues).toEqual([expect.objectContaining({ path: 'week' })]);
  });

  it('still accepts a valid ISO week on GET /api/entries', async () => {
    const res = await request(app)
      .get('/api/entries?week=2026-W07')
      .set(headers());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rejects ?week=garbage on GET /api/summary/weekly with 400', async () => {
    const res = await request(app)
      .get('/api/summary/weekly?week=garbage')
      .set(headers());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.issues).toEqual([expect.objectContaining({ path: 'week' })]);
  });

  it('still accepts a valid ISO week on GET /api/summary/weekly', async () => {
    const res = await request(app)
      .get('/api/summary/weekly?week=2026-W07')
      .set(headers());

    expect(res.status).toBe(200);
  });

  it('rejects ?month=2026-13 on GET /api/summary/monthly with 400', async () => {
    const res = await request(app)
      .get('/api/summary/monthly?month=2026-13')
      .set(headers());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.issues).toEqual([expect.objectContaining({ path: 'month' })]);
  });

  it('rejects ?month=2026-00 on GET /api/summary/monthly with 400', async () => {
    const res = await request(app)
      .get('/api/summary/monthly?month=2026-00')
      .set(headers());

    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual([expect.objectContaining({ path: 'month' })]);
  });

  it('still accepts a valid month on GET /api/summary/monthly', async () => {
    const res = await request(app)
      .get('/api/summary/monthly?month=2026-12')
      .set(headers());

    expect(res.status).toBe(200);
  });
});
