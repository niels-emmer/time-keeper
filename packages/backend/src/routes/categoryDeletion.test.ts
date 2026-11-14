/**
 * P2-4 (finding M-2) — deleting a used category must be a 409 with a count,
 * never an FK-violation 500. An unused category still deletes normally.
 */

import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test/harness.js';

function headers(user: string) {
  return {
    Host: 'category-deletion.test',
    Origin: 'http://category-deletion.test',
    'X-authentik-email': user,
  };
}

async function createCategory(app: Express, user: string, name: string): Promise<number> {
  const res = await request(app).post('/api/categories').set(headers(user)).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe('category deletion semantics (P2-4)', () => {
  let app: Express;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  it('returns 409 with the entry count and keeps a used category', async () => {
    const user = 'used@example.com';
    const categoryId = await createCategory(app, user, 'Used project');

    const entry = await request(app)
      .post('/api/entries')
      .set(headers(user))
      .send({
        categoryId,
        startTime: '2026-04-06T09:00:00.000Z',
        endTime: '2026-04-06T10:00:00.000Z',
      });
    expect(entry.status).toBe(201);

    const res = await request(app).delete(`/api/categories/${categoryId}`).set(headers(user));

    expect(res.status).toBe(409);
    expect(res.body.entries).toBe(1);

    const list = await request(app).get('/api/categories').set(headers(user));
    expect(list.body.map((category: { id: number }) => category.id)).toContain(categoryId);
  });

  it('deletes an empty category with 204', async () => {
    const user = 'empty@example.com';
    const categoryId = await createCategory(app, user, 'Unused project');

    const res = await request(app).delete(`/api/categories/${categoryId}`).set(headers(user));
    expect(res.status).toBe(204);

    const list = await request(app).get('/api/categories').set(headers(user));
    expect(list.body).toEqual([]);
  });

  it("returns 404 when deleting another user's category", async () => {
    const owner = 'delete-owner@example.com';
    const intruder = 'delete-intruder@example.com';
    const categoryId = await createCategory(app, owner, 'Owner project');

    const res = await request(app).delete(`/api/categories/${categoryId}`).set(headers(intruder));
    expect(res.status).toBe(404);

    const list = await request(app).get('/api/categories').set(headers(owner));
    expect(list.body.map((category: { id: number }) => category.id)).toContain(categoryId);
  });
});
