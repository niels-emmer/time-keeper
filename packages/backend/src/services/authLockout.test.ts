import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { createTestApp } from '../test/harness.js';

/**
 * Q23 — persisted lockout counters.
 *
 * The escalation schedule is tested through the service with an injected clock
 * (no sleeping), and persistence is tested by closing and reopening a real
 * database file, which is the closest a test gets to a process restart.
 */

type LockoutModule = typeof import('./authLockout.js');

let db: AppDatabase;
let lockout: LockoutModule;

beforeEach(async () => {
  ({ db } = await createTestApp());
  lockout = await import('./authLockout.js');
});

const T0 = new Date('2026-04-01T09:00:00.000Z');

describe('per-account exponential backoff (Q23)', () => {
  it('locks on the fifth failure for 1 minute', () => {
    for (let i = 1; i <= 4; i += 1) {
      const result = lockout.recordAccountFailure('user:alice', { now: T0, database: db });
      expect(result.lockedUntil).toBeNull();
    }

    const fifth = lockout.recordAccountFailure('user:alice', { now: T0, database: db });
    expect(fifth.failureCount).toBe(5);
    expect(fifth.retryAfterMs).toBe(60_000);
    expect(fifth.lockedUntil).toBe('2026-04-01T09:01:00.000Z');
  });

  it('doubles 1 → 2 → 4 → 8 minutes and caps at 15 minutes', () => {
    for (let i = 1; i <= 4; i += 1) {
      lockout.recordAccountFailure('user:alice', { now: T0, database: db });
    }

    const delays: number[] = [];
    for (let i = 5; i <= 10; i += 1) {
      const result = lockout.recordAccountFailure('user:alice', { now: T0, database: db });
      delays.push(result.retryAfterMs);
    }

    expect(delays.slice(0, 4)).toEqual([60_000, 120_000, 240_000, 480_000]);
    // The fifth doubling would be 16 minutes; the cap holds it at 15.
    expect(delays.slice(4)).toEqual([900_000, 900_000]);
  });

  it('reports the lock and its remaining time', () => {
    for (let i = 1; i <= 5; i += 1) {
      lockout.recordAccountFailure('user:alice', { now: T0, database: db });
    }

    const during = lockout.checkAccountLock('user:alice', {
      now: new Date(T0.getTime() + 30_000),
      database: db,
    });
    expect(during).toEqual({ locked: true, retryAfterMs: 30_000 });

    const after = lockout.checkAccountLock('user:alice', {
      now: new Date(T0.getTime() + 60_001),
      database: db,
    });
    expect(after).toEqual({ locked: false, retryAfterMs: 0 });
  });

  it('clears the streak on success', () => {
    for (let i = 1; i <= 4; i += 1) {
      lockout.recordAccountFailure('user:alice', { now: T0, database: db });
    }
    lockout.clearAccountFailures('user:alice', db);

    // The next failure starts again at one, not five.
    const result = lockout.recordAccountFailure('user:alice', { now: T0, database: db });
    expect(result.failureCount).toBe(1);
    expect(result.lockedUntil).toBeNull();
  });
});

describe('per-IP window (Q23)', () => {
  it('allows ten attempts in a minute and blocks the eleventh', () => {
    for (let i = 1; i <= 10; i += 1) {
      const result = lockout.registerIpAttempt('203.0.113.5', { now: T0, database: db });
      expect(result.allowed).toBe(true);
      expect(result.attempts).toBe(i);
    }

    const eleventh = lockout.registerIpAttempt('203.0.113.5', { now: T0, database: db });
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.retryAfterMs).toBe(60_000);
  });

  it('resets once the minute has elapsed', () => {
    for (let i = 1; i <= 10; i += 1) {
      lockout.registerIpAttempt('203.0.113.5', { now: T0, database: db });
    }

    const next = lockout.registerIpAttempt('203.0.113.5', {
      now: new Date(T0.getTime() + 60_001),
      database: db,
    });
    expect(next.allowed).toBe(true);
    expect(next.attempts).toBe(1);
  });

  it('keeps addresses independent', () => {
    for (let i = 1; i <= 10; i += 1) {
      lockout.registerIpAttempt('203.0.113.5', { now: T0, database: db });
    }

    expect(lockout.registerIpAttempt('203.0.113.5', { now: T0, database: db }).allowed).toBe(false);
    expect(lockout.registerIpAttempt('198.51.100.7', { now: T0, database: db }).allowed).toBe(true);
  });
});

describe('persistence across a simulated restart (Q23)', () => {
  let workDir: string | undefined;

  afterEach(() => {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
      workDir = undefined;
    }
  });

  it('keeps a live lock when the database is closed and reopened', async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-lockout-'));
    const databasePath = path.join(workDir, 'time-keeper.db');

    const first = await createTestApp({ databasePath });
    const firstLockout: LockoutModule = await import('./authLockout.js');

    for (let i = 1; i <= 5; i += 1) {
      firstLockout.recordAccountFailure('user:alice', { now: T0, database: first.db });
    }
    expect(
      firstLockout.checkAccountLock('user:alice', {
        now: new Date(T0.getTime() + 1_000),
        database: first.db,
      }).locked
    ).toBe(true);

    // "Restart": discard the process-local modules and reopen the same file.
    first.db.$client.close();

    const second = await createTestApp({ databasePath });
    const secondLockout: LockoutModule = await import('./authLockout.js');

    const afterRestart = secondLockout.checkAccountLock('user:alice', {
      now: new Date(T0.getTime() + 1_000),
      database: second.db,
    });
    expect(afterRestart.locked).toBe(true);
    expect(afterRestart.retryAfterMs).toBe(59_000);

    second.db.$client.close();
  });
});
