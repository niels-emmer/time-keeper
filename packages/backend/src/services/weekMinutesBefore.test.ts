/**
 * P2-6 (finding L-4) — `getWeekMinutesBefore` must use a half-open interval.
 *
 * An entry starting exactly at the local day boundary belongs to that day's
 * own rounding bucket. Counting it as "before" as well double-counted it.
 */

import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { authHeaders, createTestApp, seedUser } from '../test/harness.js';
import { timeEntries } from '../db/schema.js';
import type { AppDatabase } from '../db/client.js';

let db: AppDatabase;

function headers(user: string) {
  return {
    Host: 'week-before.test',
    Origin: 'http://week-before.test',
    ...authHeaders(db, user),
  };
}

describe('getWeekMinutesBefore half-open interval (P2-6)', () => {
  let app: Express;
  let getWeekMinutesBefore: (userId: string, date: string) => number;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    ({ getWeekMinutesBefore } = await import('../services/summaryService.js'));
  });

  it('counts a midnight entry only in its own day, never as before', async () => {
    const user = 'midnight@example.com';
    const categoryRes = await request(app)
      .post('/api/categories')
      .set(headers(user))
      .send({ name: 'Work' });
    const categoryId = categoryRes.body.id as number;
    const now = new Date().toISOString();

    const insert = (startTime: string, endTime: string) =>
      db
        .insert(timeEntries)
        .values({ userId: seedUser(db, user), categoryId, startTime, endTime, rounded: false, createdAt: now, updatedAt: now })
        .run();

    // Monday 2026-03-30, earlier in week 2026-W14 — 60 minutes.
    insert('2026-03-30T09:00:00.000Z', '2026-03-30T10:00:00.000Z');
    // Wednesday 2026-04-01 00:00:00.000Z exactly — the day's own bucket.
    insert('2026-04-01T00:00:00.000Z', '2026-04-01T01:00:00.000Z');

    expect(getWeekMinutesBefore(seedUser(db, user), '2026-04-01')).toBe(60);
  });
});
