import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations, type AppDatabase } from '../db/client.js';
import { authAttempts, sessions, users } from '../db/schema.js';
import { base32Decode, hotp, totpStepAt } from '../lib/totp.js';
import { hashPassword } from '../lib/password.js';
import {
  confirmEnrolment,
  disableMfa,
  loginWithMfa,
  regenerateRecoveryCodes,
  startEnrolment,
} from './mfaService.js';

/**
 * Service-level MFA behaviour with an injected clock.
 *
 * The ±1-step window and the replay compare-and-set are the two places where a
 * wall clock makes a test either flaky or meaningless, so they are proved here
 * with explicit timestamps. HTTP-level coverage lives in
 * `routes/auth.mfa.test.ts`.
 */

const PASSWORD = 'correct horse battery staple';
const STEP_MS = 30 * 1000;

let db: AppDatabase;

function seedUser(email: string, username: string, role: 'user' | 'admin' = 'user'): string {
  const id = randomUUID();
  db.insert(users)
    .values({
      id,
      email,
      username,
      passwordHash: hashPassword(PASSWORD),
      role,
      mustSetPassword: false,
    })
    .run();
  return id;
}

/** Enrol + confirm at `step`, returning the secret. */
function enrolAt(userId: string, step: number): { secret: string } {
  const now = new Date(step * STEP_MS);
  const enrolled = startEnrolment({ userId, database: db });
  expect(enrolled.status).toBe('ok');
  if (enrolled.status !== 'ok') throw new Error('enrolment failed');

  const code = hotp(base32Decode(enrolled.secret), step);
  const confirmed = confirmEnrolment({ userId, code, now, database: db });
  expect(confirmed.status).toBe('ok');

  return { secret: enrolled.secret };
}

function loginAt(userId: string, secret: string, step: number, code: string) {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  return loginWithMfa({
    identifier: row?.username as string,
    password: PASSWORD,
    code,
    ip: '10.0.0.1',
    now: new Date(step * STEP_MS + 1000),
    database: db,
  });
}

beforeEach(() => {
  db = createDb(':memory:');
  runMigrations(db);
});

afterEach(() => {
  db.$client.close();
});

describe('totp window at the service level', () => {
  it('accepts the current step, ±1, and stores the accepted step (not the code)', () => {
    const userId = seedUser('window@example.com', 'window');
    const { secret } = enrolAt(userId, 1000);

    const current = loginAt(userId, secret, 1005, hotp(base32Decode(secret), 1005));
    expect(current.status).toBe('ok');

    const row = db.select().from(users).where(eq(users.id, userId)).get();
    // The stored value is the counter, i.e. seconds / 30 — not the six digits.
    expect(row?.mfaLastStep).toBe(1005);

    const next = loginAt(userId, secret, 1006, hotp(base32Decode(secret), 1007));
    expect(next.status).toBe('ok');

    const previous = loginAt(userId, secret, 1010, hotp(base32Decode(secret), 1009));
    expect(previous.status).toBe('ok');
  });

  it('rejects codes outside the ±1 window', () => {
    const userId = seedUser('outside@example.com', 'outside');
    const { secret } = enrolAt(userId, 1000);

    // Both are outside the window but still ahead of the recorded step, so this
    // is a window rejection, not a replay rejection.
    const tooOld = loginAt(userId, secret, 1005, hotp(base32Decode(secret), 1003));
    expect(tooOld.status).toBe('code_invalid');

    const tooNew = loginAt(userId, secret, 1005, hotp(base32Decode(secret), 1007));
    expect(tooNew.status).toBe('code_invalid');
  });

  it('rejects the same code twice (replay protection)', () => {
    const userId = seedUser('replay@example.com', 'replay');
    const { secret } = enrolAt(userId, 1000);

    const code = hotp(base32Decode(secret), 1010);

    expect(loginAt(userId, secret, 1010, code).status).toBe('ok');
    expect(loginAt(userId, secret, 1010, code).status).toBe('code_invalid');

    // An earlier code is dead too: the stored step only moves forward.
    expect(loginAt(userId, secret, 1011, hotp(base32Decode(secret), 1009)).status).toBe(
      'code_invalid'
    );
  });

  it('a successful challenge issues a fresh session and records the login', () => {
    const userId = seedUser('session@example.com', 'sessionuser');
    const { secret } = enrolAt(userId, 1000);

    const outcome = loginAt(userId, secret, 1010, hotp(base32Decode(secret), 1010));
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('unreachable');

    expect(outcome.session.userId).toBe(userId);
    expect(outcome.csrfToken).not.toBe('');

    const rows = db.select().from(sessions).all();
    expect(rows.some((row) => row.userId === userId)).toBe(true);
  });
});

describe('MFA failure counters stay out of the password lockout', () => {
  it('records wrong codes under an mfa: key only', () => {
    const userId = seedUser('counters@example.com', 'counters');
    const { secret } = enrolAt(userId, 1000);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = loginAt(userId, secret, 1002, '000000');
      expect(outcome.status).toBe('code_invalid');
    }

    const keys = db.select().from(authAttempts).all().map((row) => row.attemptKey);
    expect(keys).toContain(`mfa:${userId}`);
    expect(keys).not.toContain(`acct:user:${userId}`);
  });

  it('engages its own gentler lock well before a password lock would', () => {
    const userId = seedUser('gentle@example.com', 'gentle');
    const { secret } = enrolAt(userId, 1000);

    // Below the MFA threshold (10) nothing is locked.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect(loginAt(userId, secret, 1002, '000000').status).toBe('code_invalid');
    }

    // The tenth failure starts a 30-second backoff.
    expect(loginAt(userId, secret, 1002, '000000').status).toBe('code_invalid');

    const locked = loginAt(userId, secret, 1002, hotp(base32Decode(secret), 1002));
    expect(locked.status).toBe('rate_limited');
    if (locked.status === 'rate_limited') {
      expect(locked.retryAfterMs).toBeGreaterThan(0);
      expect(locked.retryAfterMs).toBeLessThanOrEqual(30 * 1000);
    }

    // …and it expires on its own.
    const later = loginWithMfa({
      identifier: 'gentle',
      password: PASSWORD,
      code: hotp(base32Decode(secret), totpStepAt(1002 * STEP_MS + 31_000 + 1000)),
      ip: '10.0.0.1',
      now: new Date(1002 * STEP_MS + 31_000 + 1000),
      database: db,
    });
    expect(later.status).toBe('ok');
  });
});

describe('disable and regenerate guards', () => {
  it('refuses to disable without the correct password', () => {
    const userId = seedUser('disable@example.com', 'disable');
    enrolAt(userId, 1000);

    expect(disableMfa({ userId, password: 'wrong', database: db }).status).toBe('incorrect');
    expect(disableMfa({ userId, password: PASSWORD, database: db }).status).toBe('ok');

    const row = db.select().from(users).where(eq(users.id, userId)).get();
    expect(row?.mfaEnabled).toBe(false);
    expect(row?.mfaSecretEnc).toBeNull();
  });

  it('refuses regeneration without the correct password and requires MFA to be on', () => {
    const userId = seedUser('regen@example.com', 'regen');
    expect(regenerateRecoveryCodes({ userId, password: PASSWORD, database: db }).status).toBe(
      'not_enabled'
    );

    enrolAt(userId, 1000);

    expect(regenerateRecoveryCodes({ userId, password: 'wrong', database: db }).status).toBe(
      'incorrect'
    );
    expect(regenerateRecoveryCodes({ userId, password: PASSWORD, database: db }).status).toBe('ok');
  });
});
