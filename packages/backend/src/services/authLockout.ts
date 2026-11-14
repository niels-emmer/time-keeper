import { eq } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/client.js';
import { authAttempts, type AuthAttemptRow } from '../db/schema.js';

/**
 * Persisted auth-rate counters (Q23, Phase B).
 *
 * Two independent limits protect `POST /api/auth/login`:
 *
 *   1. **Per IP, 10 attempts per rolling minute.** A blunt ceiling that stops a
 *      single host spraying many identifiers.
 *   2. **Per account, 5 failures then exponential backoff**: 1 min, 2, 4, 8,
 *      then capped at 15 min. Cleared on a successful password (MFA state
 *      included), and only the *password* failure counts — an MFA challenge is
 *      not a failed login.
 *
 * Both live in `auth_attempts`, not in process memory, so a restart cannot
 * reset an attack in progress. The account key is recorded for identifiers
 * that match no user as well: a locked unknown identifier and a locked real
 * account must answer identically, or the 429 becomes an account-existence
 * oracle.
 *
 * All time is injectable so the escalation schedule and expiry can be tested
 * without sleeping.
 */

export const AUTH_IP_WINDOW_MS = 60 * 1000;
export const AUTH_IP_MAX_ATTEMPTS = 10;

export const ACCOUNT_FAILURE_THRESHOLD = 5;
export const ACCOUNT_BASE_BACKOFF_MS = 60 * 1000;
export const ACCOUNT_MAX_BACKOFF_MS = 15 * 60 * 1000;

interface Clock {
  now?: Date | number;
}

interface AttemptOptions extends Clock {
  database?: AppDatabase;
}

function toMillis(value: Date | number | undefined): number {
  if (value === undefined) {
    return Date.now();
  }
  return value instanceof Date ? value.getTime() : value;
}

function accountKey(identifier: string): string {
  return `acct:${identifier.trim().toLowerCase()}`;
}

function ipKey(ip: string): string {
  return `ip:${ip}`;
}

function readRow(key: string, database: AppDatabase): AuthAttemptRow | undefined {
  return database.select().from(authAttempts).where(eq(authAttempts.attemptKey, key)).get();
}

function writeRow(
  key: string,
  values: { failureCount: number; windowStartedAt: string; lockedUntil: string | null; updatedAt: string },
  database: AppDatabase
): void {
  database
    .insert(authAttempts)
    .values({ attemptKey: key, ...values })
    .onConflictDoUpdate({
      target: authAttempts.attemptKey,
      set: values,
    })
    .run();
}

export interface IpAttemptResult {
  allowed: boolean;
  attempts: number;
  retryAfterMs: number;
}

/**
 * Count one login attempt against the caller's address.
 *
 * The window is fixed from the first attempt in it, not sliding on every
 * request: a sliding window would let an attacker at exactly 10/min keep a
 * legitimate user out indefinitely by nudging the boundary.
 */
export function registerIpAttempt(ip: string, options: AttemptOptions = {}): IpAttemptResult {
  const database = options.database ?? defaultDb;
  const nowMs = toMillis(options.now);
  const key = ipKey(ip);
  const row = readRow(key, database);

  let windowStartedMs = row ? new Date(row.windowStartedAt).getTime() : nowMs;
  let count = row?.failureCount ?? 0;

  if (nowMs - windowStartedMs >= AUTH_IP_WINDOW_MS) {
    windowStartedMs = nowMs;
    count = 0;
  }

  count += 1;
  const allowed = count <= AUTH_IP_MAX_ATTEMPTS;
  const retryAfterMs = allowed ? 0 : Math.max(0, windowStartedMs + AUTH_IP_WINDOW_MS - nowMs);

  writeRow(
    key,
    {
      failureCount: count,
      windowStartedAt: new Date(windowStartedMs).toISOString(),
      lockedUntil: row?.lockedUntil ?? null,
      updatedAt: new Date(nowMs).toISOString(),
    },
    database
  );

  return { allowed, attempts: count, retryAfterMs };
}

export interface AccountLockState {
  locked: boolean;
  retryAfterMs: number;
}

/**
 * Report whether an identifier is currently locked out.
 *
 * An expired lock is cleared in place so the next failure starts a fresh
 * escalation from one, rather than inheriting the count that produced the lock.
 */
export function checkAccountLock(identifier: string, options: AttemptOptions = {}): AccountLockState {
  const database = options.database ?? defaultDb;
  const nowMs = toMillis(options.now);
  const key = accountKey(identifier);
  const row = readRow(key, database);

  if (!row?.lockedUntil) {
    return { locked: false, retryAfterMs: 0 };
  }

  const lockedUntilMs = new Date(row.lockedUntil).getTime();
  if (nowMs < lockedUntilMs) {
    return { locked: true, retryAfterMs: lockedUntilMs - nowMs };
  }

  writeRow(
    key,
    {
      failureCount: 0,
      windowStartedAt: new Date(nowMs).toISOString(),
      lockedUntil: null,
      updatedAt: new Date(nowMs).toISOString(),
    },
    database
  );

  return { locked: false, retryAfterMs: 0 };
}

export interface AccountFailureResult {
  failureCount: number;
  lockedUntil: string | null;
  retryAfterMs: number;
}

/**
 * Backoff after the Nth consecutive password failure.
 *
 * 5 → 1 min, 6 → 2 min, 7 → 4 min, 8 → 8 min, 9+ → the 15 min cap.
 */
export function recordAccountFailure(
  identifier: string,
  options: AttemptOptions = {}
): AccountFailureResult {
  const database = options.database ?? defaultDb;
  const nowMs = toMillis(options.now);
  const key = accountKey(identifier);
  const row = readRow(key, database);

  const failureCount = (row?.failureCount ?? 0) + 1;
  let lockedUntil: string | null = null;

  if (failureCount >= ACCOUNT_FAILURE_THRESHOLD) {
    const exponent = failureCount - ACCOUNT_FAILURE_THRESHOLD;
    const backoffMs = Math.min(ACCOUNT_BASE_BACKOFF_MS * 2 ** exponent, ACCOUNT_MAX_BACKOFF_MS);
    lockedUntil = new Date(nowMs + backoffMs).toISOString();
  }

  writeRow(
    key,
    {
      failureCount,
      windowStartedAt: row?.windowStartedAt ?? new Date(nowMs).toISOString(),
      lockedUntil,
      updatedAt: new Date(nowMs).toISOString(),
    },
    database
  );

  return {
    failureCount,
    lockedUntil,
    retryAfterMs: lockedUntil ? new Date(lockedUntil).getTime() - nowMs : 0,
  };
}

/** A successful password (or an MFA challenge after a correct password) clears the backoff. */
export function clearAccountFailures(identifier: string, database: AppDatabase = defaultDb): void {
  database.delete(authAttempts).where(eq(authAttempts.attemptKey, accountKey(identifier))).run();
}

/** Total rows, for tests and operational inspection. */
export function countAttemptRows(database: AppDatabase = defaultDb): number {
  return database.select().from(authAttempts).all().length;
}
