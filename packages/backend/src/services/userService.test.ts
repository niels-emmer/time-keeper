import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { users } from '../db/schema.js';
import { verifyPassword } from '../lib/password.js';
import { createTestApp, seedUser } from '../test/harness.js';

/**
 * Account bootstrap and proxy provisioning:
 *   Q2  ADMIN_EMAIL names the first administrator
 *   Q3  migrated accounts get no password, only `must_set_password`
 *   Q18 production fails to boot when ADMIN_EMAIL is missing or unmatched
 *   Q21 local development seeds a real admin so login can be exercised
 */

const originalEnv = { ...process.env };

let db: AppDatabase;
let userService: typeof import('./userService.js');

beforeEach(async () => {
  process.env = { ...originalEnv };
  ({ db } = await createTestApp());
  userService = await import('./userService.js');
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('ensureProxyUser (proxy-path provisioning)', () => {
  it('creates an account with no usable password and a policy-compliant username', () => {
    const { user, created } = userService.ensureProxyUser('Alice@Example.com', db);

    expect(created).toBe(true);
    expect(user.email).toBe('alice@example.com');
    expect(user.username).toBe('alice');
    expect(user.role).toBe('user');
    expect(user.mustSetPassword).toBe(true);
    expect(verifyPassword('', user.passwordHash)).toBe(false);
    expect(verifyPassword('anything', user.passwordHash)).toBe(false);
  });

  it('is idempotent and case-insensitive', () => {
    const first = userService.ensureProxyUser('alice@example.com', db);
    const second = userService.ensureProxyUser('ALICE@EXAMPLE.COM', db);

    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(db.select().from(users).all()).toHaveLength(1);
  });
});

describe('generateUniqueUsername (Q14)', () => {
  it('derives a username from the local part', () => {
    expect(userService.generateUniqueUsername('jane.doe@example.com', db)).toBe('jane-doe');
  });

  it('never mints a reserved name', () => {
    for (const reserved of userService.RESERVED_USERNAMES) {
      const username = userService.generateUniqueUsername(`${reserved}@example.com`, db);
      expect(reserved).not.toBe(username);
      expect(userService.RESERVED_USERNAMES).not.toContain(username);
      // Short reserved names ('me', 'api') fall back to the generic slug rather
      // than being prefixed; the point is only that the result is legal.
      expect(userService.isValidUsername(username)).toBe(true);
    }
  });

  it('fits the 3-32 character window', () => {
    expect(userService.generateUniqueUsername('ro@example.com', db)).toBe('user');
    const long = userService.generateUniqueUsername(`${'a'.repeat(60)}@example.com`, db);
    expect(long).toHaveLength(32);
    expect(userService.isValidUsername(long)).toBe(true);
  });

  it('de-collides against existing accounts', () => {
    seedUser(db, 'first@example.com');
    db.insert(users)
      .values({
        id: 'existing-id',
        email: 'jane.doe@example.com',
        username: 'jane-doe',
        passwordHash: 'unusable$test',
        role: 'user',
        mustSetPassword: true,
      })
      .run();

    expect(userService.generateUniqueUsername('jane.doe@example.com', db)).toBe('jane-doe-2');
  });
});

describe('ensureAdminFromEmail (Q2 / Q18)', () => {
  it('promotes the matching account', () => {
    const id = seedUser(db, 'owner@example.com');

    const result = userService.ensureAdminFromEmail('Owner@Example.com', {
      isProduction: true,
    }, db);

    expect(result?.promoted).toBe(true);
    expect(result?.user.role).toBe('admin');
    expect(db.select().from(users).where(eq(users.id, id)).get()?.role).toBe('admin');
  });

  it('is idempotent for an existing admin', () => {
    seedUser(db, 'owner@example.com', { role: 'admin' });

    const result = userService.ensureAdminFromEmail('owner@example.com', { isProduction: true }, db);

    expect(result?.promoted).toBe(false);
    expect(result?.user.role).toBe('admin');
  });

  it('refuses to boot in production without ADMIN_EMAIL', () => {
    expect(() =>
      userService.ensureAdminFromEmail(undefined, { isProduction: true }, db)
    ).toThrow(/ADMIN_EMAIL is not set/);

    expect(() => userService.ensureAdminFromEmail('  ', { isProduction: true }, db)).toThrow(
      /ADMIN_EMAIL is not set/
    );
  });

  it('refuses to boot in production when ADMIN_EMAIL matches no user', () => {
    seedUser(db, 'someone@example.com');

    expect(() =>
      userService.ensureAdminFromEmail('owner@example.com', { isProduction: true }, db)
    ).toThrow(/matches no user/);
  });

  it('warns and continues outside production', () => {
    const warnings: string[] = [];

    const missing = userService.ensureAdminFromEmail(undefined, {
      isProduction: false,
      warn: (message) => warnings.push(message),
    }, db);
    const unmatched = userService.ensureAdminFromEmail('nobody@example.com', {
      isProduction: false,
      warn: (message) => warnings.push(message),
    }, db);

    expect(missing).toBeNull();
    expect(unmatched).toBeNull();
    expect(warnings.join('\n')).toMatch(/ADMIN_EMAIL is not set/);
    expect(warnings.join('\n')).toMatch(/matches no user/);
  });
});

describe('seedDevAdmin (Q21)', () => {
  it('creates a usable local admin with the supplied password', () => {
    const result = userService.seedDevAdmin({ password: 'dev-password-123' }, db);

    expect(result?.created).toBe(true);
    expect(result?.email).toBe('admin@localhost');
    expect(result?.username).toBe('devadmin');

    const row = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    expect(row?.role).toBe('admin');
    expect(row?.mustSetPassword).toBe(false);
    expect(verifyPassword('dev-password-123', row!.passwordHash)).toBe(true);
    expect(verifyPassword('wrong', row!.passwordHash)).toBe(false);
  });

  it('prints a generated password once, and never resets an existing admin', () => {
    const messages: string[] = [];
    const warn = (message: string) => messages.push(message);

    const created = userService.seedDevAdmin({ warn }, db);
    expect(created?.created).toBe(true);
    expect(created?.password).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(messages.join('\n')).toMatch(/LOCAL DEVELOPMENT ADMIN CREATED/);
    expect(messages.join('\n')).toContain(created!.password);

    const again = userService.seedDevAdmin({ warn }, db);
    expect(again?.created).toBe(false);
    expect(again?.password).toBe('');

    const row = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    expect(verifyPassword(created!.password, row!.passwordHash)).toBe(true);
  });

  it('promotes an existing dev account that is not an admin', () => {
    seedUser(db, 'admin@localhost');

    const result = userService.seedDevAdmin({ password: 'ignored' }, db);

    expect(result?.created).toBe(false);
    const row = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    expect(row?.role).toBe('admin');
  });
});
