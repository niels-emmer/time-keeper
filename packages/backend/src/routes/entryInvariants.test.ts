/**
 * P2-1 (finding H-1) — one active timer, enforced by the database.
 *
 * Before this change `PATCH /api/entries/:id` accepted `endTime: null` and
 * no DB constraint stopped a second row with `end_time IS NULL`. Both could
 * produce two running timers for one user, which breaks invariant I-003 and
 * makes the Track/summary screens disagree. These tests fail without the
 * schema change and the partial unique index from migration 0009.
 */

import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { createTestApp, seedUser } from '../test/harness.js';
import { timeEntries } from '../db/schema.js';
import type { AppDatabase } from '../db/client.js';

function headers(user: string) {
  return {
    Host: 'entry-invariants.test',
    Origin: 'http://entry-invariants.test',
    'X-authentik-email': user,
  };
}

function nowIso() {
  return new Date().toISOString();
}

async function createCategory(app: Express, user: string, name: string): Promise<number> {
  const res = await request(app).post('/api/categories').set(headers(user)).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createCompletedEntry(
  app: Express,
  user: string,
  categoryId: number,
  startTime = '2026-03-02T09:00:00.000Z',
  endTime = '2026-03-02T10:00:00.000Z'
): Promise<number> {
  const res = await request(app)
    .post('/api/entries')
    .set(headers(user))
    .send({ categoryId, startTime, endTime });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe('one-active-timer invariant (P2-1)', () => {
  let app: Express;
  let db: AppDatabase;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  it('rejects PATCH endTime:null with 400 instead of reopening an entry', async () => {
    const user = 'patch-null@example.com';
    const userId = seedUser(db, user);
    const categoryId = await createCategory(app, user, 'Project Alpha');
    const entryId = await createCompletedEntry(app, user, categoryId);

    const res = await request(app)
      .patch(`/api/entries/${entryId}`)
      .set(headers(user))
      .send({ endTime: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.issues).toEqual([expect.objectContaining({ path: 'endTime' })]);

    // The completed entry is untouched: no accidental second running timer.
    const open = db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)))
      .all();
    expect(open).toHaveLength(0);
  });

  it('fails a direct INSERT of a second open row for the same user', async () => {
    const user = 'direct-insert@example.com';
    const userId = seedUser(db, user);
    const categoryId = await createCategory(app, user, 'Project Beta');
    const now = nowIso();

    db.insert(timeEntries)
      .values({
        userId,
        categoryId,
        startTime: '2026-03-03T09:00:00.000Z',
        endTime: null,
        rounded: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    expect(() =>
      db
        .insert(timeEntries)
        .values({
          userId,
          categoryId,
          startTime: '2026-03-03T11:00:00.000Z',
          endTime: null,
          rounded: false,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    ).toThrow(/UNIQUE constraint failed/);

    const open = db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)))
      .all();
    expect(open).toHaveLength(1);
  });

  it('still allows each user their own single open row (partial index)', async () => {
    const alice = 'partial-alice@example.com';
    const bob = 'partial-bob@example.com';
    const aliceId = seedUser(db, alice);
    const bobId = seedUser(db, bob);
    const aliceCategory = await createCategory(app, alice, 'Project A');
    const bobCategory = await createCategory(app, bob, 'Project A');
    const now = nowIso();

    for (const [user, categoryId] of [
      [aliceId, aliceCategory],
      [bobId, bobCategory],
    ] as const) {
      db.insert(timeEntries)
        .values({
          userId: user,
          categoryId,
          startTime: '2026-03-04T09:00:00.000Z',
          endTime: null,
          rounded: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const open = db.select().from(timeEntries).where(isNull(timeEntries.endTime)).all();
    expect(open.filter((row) => row.userId === aliceId)).toHaveLength(1);
    expect(open.filter((row) => row.userId === bobId)).toHaveLength(1);
  });
});
