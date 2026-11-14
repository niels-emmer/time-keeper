/**
 * P2-5 (finding M-9) — rounding is atomic, and a manual cell edit sticks.
 *
 * Without a transaction a throw mid-loop leaves a day half-rounded and
 * half-flagged. Without an outer transaction a `round-week` failure leaves
 * earlier days committed. And `adjust-cell` used to leave `rounded=false`, so
 * "Round week" silently re-rounded the user's typed value.
 */

import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { authHeaders, createTestApp, seedUser } from '../test/harness.js';
import { timeEntries } from '../db/schema.js';
import type { AppDatabase } from '../db/client.js';

let db: AppDatabase;

function headers(user: string) {
  return {
    Host: 'rounding.test',
    Origin: 'http://rounding.test',
    ...authHeaders(db, user),
  };
}

async function createCategory(app: Express, user: string, name: string): Promise<number> {
  const res = await request(app).post('/api/categories').set(headers(user)).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

function insertEntry(
  db: AppDatabase,
  user: string,
  categoryId: number,
  startTime: string,
  endTime: string
): number {
  const now = new Date().toISOString();
  return db
    .insert(timeEntries)
    .values({ userId: seedUser(db, user), categoryId, startTime, endTime, rounded: false, createdAt: now, updatedAt: now })
    .returning()
    .get().id;
}

/** Replace `db.update` so the Nth call throws, simulating a mid-loop failure. */
function failOnUpdateCall(db: AppDatabase, throwOnCall: number): () => void {
  const target = db as unknown as { update: (...args: unknown[]) => unknown };
  const original = target.update.bind(db);
  let calls = 0;

  target.update = (...args: unknown[]) => {
    calls += 1;
    if (calls === throwOnCall) {
      throw new Error('injected rounding failure');
    }
    return original(...args);
  };

  return () => {
    target.update = original;
  };
}

describe('rounding atomicity and manual edits (P2-5)', () => {
  let app: Express;
  let applyRounding: (userId: string, date: string) => unknown;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    ({ applyRounding } = await import('../services/roundingService.js'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rolls back every write when a mid-loop update throws', async () => {
    const user = 'txn@example.com';
    const userId = seedUser(db, user);
    const firstCategory = await createCategory(app, user, 'First');
    const secondCategory = await createCategory(app, user, 'Second');

    const firstEnd = '2026-04-06T10:01:00.000Z';
    const secondEnd = '2026-04-06T12:01:00.000Z';
    const firstEntryId = insertEntry(db, user, firstCategory, '2026-04-06T09:00:00.000Z', firstEnd);
    const secondEntryId = insertEntry(db, user, secondCategory, '2026-04-06T11:00:00.000Z', secondEnd);

    const restore = failOnUpdateCall(db, 2);
    try {
      expect(() => applyRounding(userId, '2026-04-06')).toThrow('injected rounding failure');
    } finally {
      restore();
    }

    for (const [id, expectedEnd] of [
      [firstEntryId, firstEnd],
      [secondEntryId, secondEnd],
    ] as const) {
      const row = db.select().from(timeEntries).where(eq(timeEntries.id, id)).get();
      expect(row?.endTime).toBe(expectedEnd);
      expect(row?.rounded).toBe(false);
    }
  });

  it('returns a 500 from round-week and rolls back earlier days when a later day throws', async () => {
    const user = 'week-txn@example.com';
    const categoryId = await createCategory(app, user, 'Week');

    const mondayEnd = '2026-04-06T10:01:00.000Z';
    const tuesdayEnd = '2026-04-07T10:01:00.000Z';
    const mondayId = insertEntry(db, user, categoryId, '2026-04-06T09:00:00.000Z', mondayEnd);
    const tuesdayId = insertEntry(db, user, categoryId, '2026-04-07T09:00:00.000Z', tuesdayEnd);

    // Monday's rounding writes first; Tuesday's write is the second call.
    const restore = failOnUpdateCall(db, 2);
    try {
      const res = await request(app)
        .post('/api/summary/round-week')
        .set(headers(user))
        .send({ week: '2026-W15' });
      expect(res.status).toBe(500);
    } finally {
      restore();
    }

    for (const [id, expectedEnd] of [
      [mondayId, mondayEnd],
      [tuesdayId, tuesdayEnd],
    ] as const) {
      const row = db.select().from(timeEntries).where(eq(timeEntries.id, id)).get();
      expect(row?.endTime).toBe(expectedEnd);
      expect(row?.rounded).toBe(false);
    }
  });

  it('keeps a manually adjusted cell through a round-week', async () => {
    const user = 'adjust@example.com';
    const categoryId = await createCategory(app, user, 'Adjusted');
    insertEntry(db, user, categoryId, '2026-04-06T09:00:00.000Z', '2026-04-06T13:00:00.000Z');

    const adjust = await request(app)
      .patch('/api/summary/adjust-cell')
      .set(headers(user))
      .send({ date: '2026-04-06', categoryId, minutes: 250 });
    expect(adjust.status).toBe(200);

    const roundWeek = await request(app)
      .post('/api/summary/round-week')
      .set(headers(user))
      .send({ week: '2026-W15' });
    expect(roundWeek.status).toBe(200);

    const entries = await request(app)
      .get('/api/entries?date=2026-04-06')
      .set(headers(user));
    expect(entries.status).toBe(200);
    const minutes =
      (new Date(entries.body[0].endTime).getTime() - new Date(entries.body[0].startTime).getTime()) / 60_000;
    expect(minutes).toBe(250);
  });
});
