import { and, eq, isNull, lt, lte, or } from 'drizzle-orm';
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

/**
 * MFA-specific limits (Phase D).
 *
 * A wrong TOTP code is **not** a failed password, and it must not be able to
 * lock the password path: anyone who knows a username could otherwise keep a
 * legitimate user out of their own account by submitting garbage codes. So the
 * MFA counter lives in its own key namespace with its own, gentler schedule:
 *
 *   * 10 wrong codes before anything happens (typos and a stale clock are
 *     common; 5 is too tight for a 6-digit code read off a phone),
 *   * then 30 s, doubling to a 5-minute cap — long enough to make online
 *     guessing pointless, short enough that a fat-fingered human is never
 *     locked out for the afternoon,
 *   * cleared by a successful code, and it never touches `acct:` rows.
 *
 * The per-IP window for the completion endpoint is separate as well, so a run
 * of MFA typos cannot exhaust the password endpoint's per-minute budget.
 */
export const MFA_FAILURE_THRESHOLD = 10;
export const MFA_BASE_BACKOFF_MS = 30 * 1000;
export const MFA_MAX_BACKOFF_MS = 5 * 60 * 1000;
export const MFA_IP_WINDOW_MS = 60 * 1000;
export const MFA_IP_MAX_ATTEMPTS = 20;

/**
 * Dedicated per-IP buckets for the two public credential-redemption endpoints
 * (`POST /api/auth/accept-invite`, `POST /api/auth/reset`).
 *
 * These did not have their own limit: they sat on the general 120/min `/api`
 * ceiling, which is a throughput budget, not a guessing budget. An invite
 * token and a reset code are both high-entropy secrets, so 10 attempts per
 * quarter hour per address makes online guessing pointless while leaving room
 * for a legitimate person who mistypes their email, username or password a few
 * times.
 *
 * Like every other counter here, these are rows in `auth_attempts`, so a
 * restart cannot reset an attack in progress.
 */
export const INVITE_IP_WINDOW_MS = 15 * 60 * 1000;
export const INVITE_IP_MAX_ATTEMPTS = 10;
export const RESET_IP_WINDOW_MS = 15 * 60 * 1000;
export const RESET_IP_MAX_ATTEMPTS = 10;

/**
 * How long a counter row is kept. Matches the 90-day audit-retention decision
 * (Q12) so `auth_attempts` cannot grow without bound on an install with no
 * scheduler. Pruning never removes a row whose lockout is still in effect.
 */
export const AUTH_ATTEMPT_RETENTION_DAYS = 90;

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

function mfaKey(userId: string): string {
  return `mfa:${userId}`;
}

function mfaIpKey(ip: string): string {
  return `mfa-ip:${ip}`;
}

function inviteIpKey(ip: string): string {
  return `invite-ip:${ip}`;
}

function resetIpKey(ip: string): string {
  return `reset-ip:${ip}`;
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

export interface AccountLockState {
  locked: boolean;
  retryAfterMs: number;
}

export interface AccountFailureResult {
  failureCount: number;
  lockedUntil: string | null;
  retryAfterMs: number;
}

/**
 * Count one request against a fixed window.
 *
 * The window is fixed from the first attempt in it, not sliding on every
 * request: a sliding window would let an attacker at exactly the limit keep a
 * legitimate user out indefinitely by nudging the boundary.
 */
function registerWindowAttempt(
  key: string,
  policy: { windowMs: number; maxAttempts: number },
  options: AttemptOptions
): IpAttemptResult {
  const database = options.database ?? defaultDb;
  const nowMs = toMillis(options.now);

  // Opportunistic retention: this funnel is reached by every authentication
  // entry point (password, MFA, invite, reset), so a long-running process keeps
  // the table trimmed without needing a scheduler. The delete is a no-op while
  // the table is already small.
  pruneAuthAttempts({ now: new Date(nowMs), database });

  const row = readRow(key, database);

  let windowStartedMs = row ? new Date(row.windowStartedAt).getTime() : nowMs;
  let count = row?.failureCount ?? 0;

  if (nowMs - windowStartedMs >= policy.windowMs) {
    windowStartedMs = nowMs;
    count = 0;
  }

  count += 1;
  const allowed = count <= policy.maxAttempts;
  const retryAfterMs = allowed ? 0 : Math.max(0, windowStartedMs + policy.windowMs - nowMs);

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

/**
 * Report whether a key is currently locked out.
 *
 * An expired lock is cleared in place so the next failure starts a fresh
 * escalation from one, rather than inheriting the count that produced the lock.
 */
function readLock(key: string, options: AttemptOptions): AccountLockState {
  const database = options.database ?? defaultDb;
  const nowMs = toMillis(options.now);
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

/** Record one failure and escalate the backoff once the threshold is reached. */
function recordFailure(
  key: string,
  policy: { threshold: number; baseBackoffMs: number; maxBackoffMs: number },
  options: AttemptOptions
): AccountFailureResult {
  const database = options.database ?? defaultDb;
  const nowMs = toMillis(options.now);
  const row = readRow(key, database);

  const failureCount = (row?.failureCount ?? 0) + 1;
  let lockedUntil: string | null = null;

  if (failureCount >= policy.threshold) {
    const exponent = failureCount - policy.threshold;
    const backoffMs = Math.min(policy.baseBackoffMs * 2 ** exponent, policy.maxBackoffMs);
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

/** Count one login attempt against the caller's address. */
export function registerIpAttempt(ip: string, options: AttemptOptions = {}): IpAttemptResult {
  return registerWindowAttempt(
    ipKey(ip),
    { windowMs: AUTH_IP_WINDOW_MS, maxAttempts: AUTH_IP_MAX_ATTEMPTS },
    options
  );
}

export function checkAccountLock(
  identifier: string,
  options: AttemptOptions = {}
): AccountLockState {
  return readLock(accountKey(identifier), options);
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
  return recordFailure(
    accountKey(identifier),
    {
      threshold: ACCOUNT_FAILURE_THRESHOLD,
      baseBackoffMs: ACCOUNT_BASE_BACKOFF_MS,
      maxBackoffMs: ACCOUNT_MAX_BACKOFF_MS,
    },
    options
  );
}

/**
 * MFA-scoped counters (Phase D). Separate key namespace, separate policy: see
 * the constants above for why a wrong code must never touch the password path.
 */
export function registerMfaIpAttempt(ip: string, options: AttemptOptions = {}): IpAttemptResult {
  return registerWindowAttempt(
    mfaIpKey(ip),
    { windowMs: MFA_IP_WINDOW_MS, maxAttempts: MFA_IP_MAX_ATTEMPTS },
    options
  );
}

/** Count one invite-acceptance attempt against the caller's address. */
export function registerInviteIpAttempt(ip: string, options: AttemptOptions = {}): IpAttemptResult {
  return registerWindowAttempt(
    inviteIpKey(ip),
    { windowMs: INVITE_IP_WINDOW_MS, maxAttempts: INVITE_IP_MAX_ATTEMPTS },
    options
  );
}

/** Count one password-reset redemption against the caller's address. */
export function registerResetIpAttempt(ip: string, options: AttemptOptions = {}): IpAttemptResult {
  return registerWindowAttempt(
    resetIpKey(ip),
    { windowMs: RESET_IP_WINDOW_MS, maxAttempts: RESET_IP_MAX_ATTEMPTS },
    options
  );
}

export function checkMfaLock(userId: string, options: AttemptOptions = {}): AccountLockState {
  return readLock(mfaKey(userId), options);
}

export function recordMfaFailure(
  userId: string,
  options: AttemptOptions = {}
): AccountFailureResult {
  return recordFailure(
    mfaKey(userId),
    {
      threshold: MFA_FAILURE_THRESHOLD,
      baseBackoffMs: MFA_BASE_BACKOFF_MS,
      maxBackoffMs: MFA_MAX_BACKOFF_MS,
    },
    options
  );
}

/** A successful code ends the streak; it never clears a password lock. */
export function clearMfaFailures(userId: string, database: AppDatabase = defaultDb): void {
  database.delete(authAttempts).where(eq(authAttempts.attemptKey, mfaKey(userId))).run();
}

/** A successful password (or an MFA challenge after a correct password) clears the backoff. */
export function clearAccountFailures(identifier: string, database: AppDatabase = defaultDb): void {
  database.delete(authAttempts).where(eq(authAttempts.attemptKey, accountKey(identifier))).run();
}

/** Total rows, for tests and operational inspection. */
export function countAttemptRows(database: AppDatabase = defaultDb): number {
  return database.select().from(authAttempts).all().length;
}

/**
 * Retention for `auth_attempts` (Q12-consistent, 90 days).
 *
 * A row is removed only when it is older than the cutoff **and** no lockout is
 * still in force. The second condition is what keeps the pruning safe: deleting
 * a row with a future `locked_until` would end an active lockout early, which is
 * exactly what an attacker would want.
 *
 * Called at startup and opportunistically from the per-IP attempt funnel, so an
 * install with no external scheduler still cannot accumulate rows forever.
 */
export function pruneAuthAttempts(
  options: { retentionDays?: number; now?: Date; database?: AppDatabase } = {}
): number {
  const database = options.database ?? defaultDb;
  const now = options.now ?? new Date();
  const days = options.retentionDays ?? AUTH_ATTEMPT_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  return database
    .delete(authAttempts)
    .where(
      and(
        lt(authAttempts.updatedAt, cutoff),
        or(isNull(authAttempts.lockedUntil), lte(authAttempts.lockedUntil, nowIso))
      )
    )
    .run().changes;
}
