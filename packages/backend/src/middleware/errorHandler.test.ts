/**
 * P1-3 / finding H-4 — validation failures are client errors.
 *
 * Before this task every `.parse()` failure escaped as a ZodError with no
 * `statusCode`, so `errorHandler` treated it as an unexpected fault and
 * returned 500. These tests pin the new contract end to end through Express:
 * 400, `{ error, issues: [{ path, message }] }`, no echo of the offending
 * input, and no request body in the server log.
 */

import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { authHeaders, createTestApp } from '../test/harness.js';

function captureConsole(): string[] {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'log').mockImplementation(capture);
  return lines;
}

describe('errorHandler (P1-3)', () => {
  let app: Express;
  let db: AppDatabase;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns an empty POST /api/timer/start into a 400 with path/message issues', async () => {
    const logs = captureConsole();

    const res = await request(app)
      .post('/api/timer/start')
      .set('Host', 'p1-3.test')
      .set('Origin', 'http://p1-3.test')
      .set(authHeaders(db, 'p1-3@example.com'))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.issues).toEqual([
      expect.objectContaining({ path: 'categoryId' }),
    ]);
    for (const issue of res.body.issues) {
      // Only `path` and `message` — the response must not carry zod's `input`.
      expect(Object.keys(issue).sort()).toEqual(['message', 'path']);
    }
    // The log names the field but stays free of anything request-shaped.
    expect(logs.join('\n')).toContain('categoryId');
    expect(logs.join('\n')).not.toContain('p1-3@example.com');
  });

  it('never logs or echoes the request body when validation fails', async () => {
    const marker = 'TOP-SECRET-BODY-42';
    const logs = captureConsole();

    const res = await request(app)
      .post('/api/timer/start')
      .set('Host', 'p1-3.test')
      .set('Origin', 'http://p1-3.test')
      .set(authHeaders(db, 'p1-3@example.com'))
      .send({ categoryId: 'not-a-number', secret: marker });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(marker);
    expect(logs.join('\n')).not.toContain(marker);
    expect(logs.join('\n')).toContain('categoryId');
  });
});
