import { randomBytes, randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/client.js';
import { users, type UserRow } from '../db/schema.js';
import { createUnusablePasswordHash, hashPassword } from '../lib/password.js';

/**
 * User lookup, proxy provisioning and bootstrap (A1, A4, A6, Q2, Q3, Q18, Q21).
 *
 * Identity resolution lives here rather than in the middleware so the proxy
 * path, the dev seed and the tests all share one definition of "who is this".
 */

/** Usernames that must never exist, so they cannot be confused with routes. */
export const RESERVED_USERNAMES: readonly string[] = ['admin', 'api', 'me', 'root', 'system'];

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

/** Emails are stored and looked up lower-cased and trimmed (Q15). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(username) &&
    !RESERVED_USERNAMES.includes(username)
  );
}

export function findUserByEmail(
  email: string,
  database: AppDatabase = defaultDb
): UserRow | undefined {
  return database.select().from(users).where(eq(users.email, normalizeEmail(email))).get();
}

export function findUserById(
  id: string,
  database: AppDatabase = defaultDb
): UserRow | undefined {
  return database.select().from(users).where(eq(users.id, id)).get();
}

function slugCandidate(source: string): string {
  const localPart = source.includes('@') ? source.slice(0, source.indexOf('@')) : source;

  const filtered = localPart
    .toLowerCase()
    .split('')
    .map((character) => (/[a-z0-9_-]/.test(character) ? character : '-'))
    .join('')
    .replace(/^-+|-+$/g, '');

  if (filtered.length === 0) {
    return 'user';
  }
  if (filtered.length < USERNAME_MIN_LENGTH) {
    return 'user';
  }
  return filtered.slice(0, USERNAME_MAX_LENGTH);
}

/**
 * Derive a free username from an email/username source (Q14).
 *
 * Same shape as the SQL backfill in migration 0011: local part, filtered to
 * `[a-z0-9_-]`, 3–32 characters, reserved names avoided, `-N` suffix on
 * collision.
 */
export function generateUniqueUsername(
  source: string,
  database: AppDatabase = defaultDb
): string {
  let base = slugCandidate(source);
  if (RESERVED_USERNAMES.includes(base)) {
    base = `${base}-1`;
  }

  let candidate = base;
  let suffix = 1;

  while (
    !isValidUsername(candidate) ||
    database.select().from(users).where(eq(users.username, candidate)).get() !== undefined
  ) {
    suffix += 1;
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, USERNAME_MAX_LENGTH - suffixText.length)}${suffixText}`;
  }

  return candidate;
}

export interface ProvisionedUser {
  user: UserRow;
  created: boolean;
}

/**
 * Return the user for an email, creating one on first sight.
 *
 * This preserves the pre-Phase-A behaviour of the proxy path: an Authentik user
 * that the app has never seen gets an account the first time they make a
 * request, rather than a 401. The account has no usable password and
 * `must_set_password`, so it can only be used through the trusted proxy until
 * an admin issues a reset code (Q3).
 */
export function ensureProxyUser(
  email: string,
  database: AppDatabase = defaultDb
): ProvisionedUser {
  const normalized = normalizeEmail(email);
  const existing = database.select().from(users).where(eq(users.email, normalized)).get();
  if (existing) {
    return { user: existing, created: false };
  }

  // `created_at` is left to the column default so it matches rows the
  // migration wrote (SQLite `datetime('now')`, not an ISO string).
  const inserted = database
    .insert(users)
    .values({
      id: randomUUID(),
      email: normalized,
      username: generateUniqueUsername(normalized, database),
      passwordHash: createUnusablePasswordHash(),
      role: 'user',
      mustSetPassword: true,
    })
    .returning()
    .get();

  return { user: inserted, created: true };
}

export function promoteToAdmin(userId: string, database: AppDatabase = defaultDb): void {
  database.update(users).set({ role: 'admin' }).where(eq(users.id, userId)).run();
}

export interface AdminBootstrapResult {
  user: UserRow;
  promoted: boolean;
}

/**
 * Promote the account named by `ADMIN_EMAIL` (Q2).
 *
 * Q18: in production a missing `ADMIN_EMAIL` — or one that matches no migrated
 * user — is fatal. A running instance with no administrator cannot be
 * administered, and discovering that later means the operator has to find the
 * database. Outside production it warns and continues with no admin.
 */
export function ensureAdminFromEmail(
  adminEmail: string | undefined,
  options: { isProduction: boolean; warn?: (message: string) => void },
  database: AppDatabase = defaultDb
): AdminBootstrapResult | null {
  const warn = options.warn ?? ((message: string) => console.warn(message));

  if (!adminEmail || adminEmail.trim() === '') {
    const message =
      'ADMIN_EMAIL is not set — no administrator will be promoted. Set ADMIN_EMAIL to the email of the account that should administer this instance.';
    if (options.isProduction) {
      throw new Error(message);
    }
    warn(`[auth] ${message}`);
    return null;
  }

  const user = findUserByEmail(adminEmail, database);
  if (!user) {
    const message = `ADMIN_EMAIL (${normalizeEmail(adminEmail)}) matches no user — no administrator exists. It must match an existing account (for a migrated database, one of the pre-existing emails).`;
    if (options.isProduction) {
      throw new Error(message);
    }
    warn(`[auth] ${message}`);
    return null;
  }

  if (user.role === 'admin') {
    return { user, promoted: false };
  }

  promoteToAdmin(user.id, database);
  return { user: { ...user, role: 'admin' }, promoted: true };
}

export interface DevAdminSeed {
  email: string;
  username: string;
  password: string;
  created: boolean;
}

export const DEV_ADMIN_EMAIL = 'admin@localhost';
const DEV_ADMIN_USERNAME = 'devadmin';

/**
 * Local-mode development admin (Q21).
 *
 * The point of `AUTH_MODE=local` in development is that the real login flow is
 * what gets exercised, so there must be an account with a usable password. When
 * one already exists the password is not reset and not printed — a restart must
 * not silently change the credentials a developer is using.
 */
export function seedDevAdmin(
  options: { password?: string; warn?: (message: string) => void } = {},
  database: AppDatabase = defaultDb
): DevAdminSeed | null {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const normalized = normalizeEmail(DEV_ADMIN_EMAIL);
  const existing = database.select().from(users).where(eq(users.email, normalized)).get();

  if (existing) {
    if (existing.role !== 'admin') {
      promoteToAdmin(existing.id, database);
    }
    return { email: existing.email, username: existing.username, password: '', created: false };
  }

  const password = options.password?.trim() || randomBytes(12).toString('base64url');
  const now = new Date().toISOString();

  const user = database
    .insert(users)
    .values({
      id: randomUUID(),
      email: normalized,
      username: DEV_ADMIN_USERNAME,
      passwordHash: hashPassword(password),
      passwordUpdatedAt: now,
      role: 'admin',
      mustSetPassword: false,
    })
    .returning()
    .get();

  if (!options.password) {
    warn(
      [
        '',
        '  ────────────────────────────────────────────────────────────────',
        '  LOCAL DEVELOPMENT ADMIN CREATED (AUTH_MODE=local, non-production)',
        `    email:    ${user.email}`,
        `    username: ${user.username}`,
        `    password: ${password}`,
        '  Printed once, at creation. Set DEV_ADMIN_PASSWORD to choose it, or',
        '  delete the account to have a new one generated.',
        '  ────────────────────────────────────────────────────────────────',
        '',
      ].join('\n')
    );
  }

  return { email: user.email, username: user.username, password, created: true };
}
