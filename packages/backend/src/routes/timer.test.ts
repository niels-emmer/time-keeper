/**
 * P2-2 (finding H-2) — starting a timer must reject a category owned by
 * another user, and the ownership guard must live in the service so every
 * caller inherits it.
 *
 * Also covers the P2-1 companion behaviour: `startTimer` auto-stops the
 * running timer, so at most one open row can survive a start.
 */

import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { createTestApp } from '../test/harness.js';
import { timeEntries } from '../db/schema.js';
import type { AppDatabase } from '../db/client.js';

function headers(user: string) {
  return {
    Host: 'timer.test',
    Origin: 'http://timer.test',
    'X-authentik-email': user,
  };
}

async function createCategory(app: Express, user: string, name: string): Promise<number> {
  const res = await request(app).post('/api/categories').set(headers(user)).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe('timer start ownership (P2-2)', () => {
  let app: Express;
  let db: AppDatabase;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  it("rejects starting a timer on another user's category with 400 and inserts nothing", async () => {
    const alice = 'owner-alice@example.com';
    const bob = 'intruder-bob@example.com';
    const aliceCategory = await createCategory(app, alice, "Alice's project");

    const res = await request(app)
      .post('/api/timer/start')
      .set(headers(bob))
      .send({ categoryId: aliceCategory });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Category not found');

    const bobRows = db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.userId, bob))
      .all();
    expect(bobRows).toHaveLength(0);
  });

  it('still starts a timer on the caller own category', async () => {
    const user = 'owner-self@example.com';
    const categoryId = await createCategory(app, user, 'Own project');

    const res = await request(app)
      .post('/api/timer/start')
      .set(headers(user))
      .send({ categoryId });

    expect(res.status).toBe(201);
    expect(res.body.categoryId).toBe(categoryId);
    expect(res.body.endTime).toBeNull();
  });

  it('auto-stops the previous timer so exactly one open row remains', async () => {
    const user = 'auto-stop@example.com';
    const first = await createCategory(app, user, 'First project');
    const second = await createCategory(app, user, 'Second project');

    const firstStart = await request(app)
      .post('/api/timer/start')
      .set(headers(user))
      .send({ categoryId: first });
    expect(firstStart.status).toBe(201);

    const secondStart = await request(app)
      .post('/api/timer/start')
      .set(headers(user))
      .send({ categoryId: second });
    expect(secondStart.status).toBe(201);

    const open = db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, user), isNull(timeEntries.endTime)))
      .all();
    expect(open).toHaveLength(1);
    expect(open[0].categoryId).toBe(second);

    const status = await request(app).get('/api/timer').set(headers(user));
    expect(status.status).toBe(200);
    expect(status.body.active).toBe(true);
    expect(status.body.entry.categoryId).toBe(second);
  });
});
