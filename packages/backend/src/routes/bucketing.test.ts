/**
 * P2-3 (finding H-3, DEC-2) — bucketing follows the user's local day.
 *
 * Storage remains UTC. Every read path (day log, weekly grouping, month
 * bounds, rounding window) resolves the user's `user_settings.timezone` and
 * buckets through the shared local-day helpers. These tests use
 * Europe/Amsterdam and pin the clock where the "current day" matters.
 */

import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { authHeaders, createTestApp, seedUser } from '../test/harness.js';
import { timeEntries } from '../db/schema.js';
import type { AppDatabase } from '../db/client.js';

const AMS = 'Europe/Amsterdam';

let db: AppDatabase;

function headers(user: string) {
  return {
    Host: 'bucketing.test',
    Origin: 'http://bucketing.test',
    ...authHeaders(db, user),
  };
}

async function createTimezoneUser(app: Express, user: string, timeZone: string): Promise<number> {
  const put = await request(app)
    .put('/api/settings')
    .set(headers(user))
    .send({ weeklyGoalHours: 40, roundingIncrementMinutes: 60, timezone: timeZone });
  expect(put.status).toBe(200);

  const created = await request(app).post('/api/categories').set(headers(user)).send({ name: 'Work' });
  expect(created.status).toBe(201);
  return created.body.id as number;
}

function addEntry(
  db: AppDatabase,
  user: string,
  categoryId: number,
  startTime: string,
  endTime: string
) {
  const now = new Date().toISOString();
  db.insert(timeEntries)
    .values({ userId: seedUser(db, user), categoryId, startTime, endTime, rounded: false, createdAt: now, updatedAt: now })
    .run();
}

describe('local-day bucketing (P2-3)', () => {
  let app: Express;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a 00:30 local entry for the local date, not the UTC date', async () => {
    const user = 'daylog@example.com';
    const categoryId = await createTimezoneUser(app, user, AMS);
    // 2026-04-01 00:30 CEST — used to be filed under 2026-03-31.
    addEntry(db, user, categoryId, '2026-03-31T22:30:00.000Z', '2026-03-31T23:30:00.000Z');

    const localDate = await request(app).get('/api/entries?date=2026-04-01').set(headers(user));
    expect(localDate.status).toBe(200);
    expect(localDate.body).toHaveLength(1);

    const utcDate = await request(app).get('/api/entries?date=2026-03-31').set(headers(user));
    expect(utcDate.status).toBe(200);
    expect(utcDate.body).toHaveLength(0);
  });

  it('groups 00:30 and 23:30 local entries into the same local day', async () => {
    const user = 'weekly@example.com';
    const categoryId = await createTimezoneUser(app, user, AMS);
    // Monday 2026-03-30 00:30 CEST (Sunday 22:30Z) — 60 minutes.
    addEntry(db, user, categoryId, '2026-03-29T22:30:00.000Z', '2026-03-29T23:30:00.000Z');
    // Wednesday 2026-04-01 00:30 CEST — 60 minutes.
    addEntry(db, user, categoryId, '2026-03-31T22:30:00.000Z', '2026-03-31T23:30:00.000Z');
    // Wednesday 2026-04-01 22:30 CEST (20:30Z) — 60 minutes.
    addEntry(db, user, categoryId, '2026-04-01T20:30:00.000Z', '2026-04-01T21:30:00.000Z');

    const res = await request(app).get('/api/summary/weekly?week=2026-W14').set(headers(user));
    expect(res.status).toBe(200);

    const byDate = new Map(
      (res.body.days as Array<{ date: string; totalMinutes: number }>).map((day) => [day.date, day.totalMinutes])
    );
    expect(byDate.get('2026-03-30')).toBe(60);
    expect(byDate.get('2026-04-01')).toBe(120);
    expect(res.body.totalMinutes).toBe(180);
  });

  it('puts a 00:30 local entry in the correct local month', async () => {
    const user = 'monthly@example.com';
    const categoryId = await createTimezoneUser(app, user, AMS);
    // 2026-04-01 00:30 CEST — must belong to April, not March.
    addEntry(db, user, categoryId, '2026-03-31T22:30:00.000Z', '2026-03-31T23:30:00.000Z');

    const april = await request(app).get('/api/summary/monthly?month=2026-04').set(headers(user));
    expect(april.status).toBe(200);
    expect(april.body.totalActualMinutes).toBe(60);

    const march = await request(app).get('/api/summary/monthly?month=2026-03').set(headers(user));
    expect(march.status).toBe(200);
    expect(march.body.totalActualMinutes).toBe(0);
  });

  it('sums a spring-forward local day (23 h) correctly', async () => {
    const user = 'spring@example.com';
    const categoryId = await createTimezoneUser(app, user, AMS);
    // 2026-03-29 01:30 CET (00:30Z) → 04:30 CEST (02:30Z): 120 real minutes
    // across the 23-hour day.
    addEntry(db, user, categoryId, '2026-03-29T00:30:00.000Z', '2026-03-29T02:30:00.000Z');

    const res = await request(app).get('/api/summary/weekly?week=2026-W13').set(headers(user));
    expect(res.status).toBe(200);
    const day = (res.body.days as Array<{ date: string; totalMinutes: number }>).find(
      (candidate) => candidate.date === '2026-03-29'
    );
    expect(day?.totalMinutes).toBe(120);
  });

  it('sums a fall-back local day (25 h) correctly', async () => {
    const user = 'fall@example.com';
    const categoryId = await createTimezoneUser(app, user, AMS);
    // 2026-10-25 01:30 CEST (23:30Z on the 24th) → 02:30 CET (01:30Z): 120
    // real minutes inside the 25-hour day.
    addEntry(db, user, categoryId, '2026-10-24T23:30:00.000Z', '2026-10-25T01:30:00.000Z');

    const res = await request(app).get('/api/summary/weekly?week=2026-W43').set(headers(user));
    expect(res.status).toBe(200);
    const day = (res.body.days as Array<{ date: string; totalMinutes: number }>).find(
      (candidate) => candidate.date === '2026-10-25'
    );
    expect(day?.totalMinutes).toBe(120);
  });

  it('uses the local clock for "current month" and days elapsed', async () => {
    const user = 'clock@example.com';
    await createTimezoneUser(app, user, AMS);

    // Fixed clock: 2026-04-01 00:30 CEST is still 2026-03-31 in UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-31T22:30:00.000Z'));

    const res = await request(app).get('/api/summary/monthly?month=2026-04').set(headers(user));
    expect(res.status).toBe(200);
    expect(res.body.isCurrentMonth).toBe(true);
    expect(res.body.daysElapsed).toBe(1);
  });
});
