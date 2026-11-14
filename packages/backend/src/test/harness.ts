import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import { vi } from 'vitest';
import type { AppDatabase } from '../db/client.js';
import { users } from '../db/schema.js';
import { createUnusablePasswordHash } from '../lib/password.js';

/**
 * Insert (or find) the `users` row for an email and return its id.
 *
 * Since Phase A / D7 every user-scoped table has a foreign key to `users.id`,
 * so a fixture that writes `categories`/`time_entries`/`api_tokens` directly
 * must own a real account first. Email stays the human-facing identity in
 * tests — it is what the `X-authentik-email` header carries — while the
 * returned id is what the row must store. Idempotent, so it is safe to call
 * from several fixtures for the same email.
 */
export function seedUser(
  database: AppDatabase,
  email: string,
  options: { role?: 'user' | 'admin' } = {}
): string {
  const normalized = email.trim().toLowerCase();
  const existing = database.select().from(users).where(eq(users.email, normalized)).get();
  if (existing) {
    return existing.id;
  }

  const id = randomUUID();
  const suffix = id.slice(0, 8);
  const localPart = (normalized.includes('@') ? normalized.slice(0, normalized.indexOf('@')) : normalized)
    .toLowerCase()
    .split('')
    .map((character) => (/[a-z0-9_-]/.test(character) ? character : '-'))
    .join('')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);

  database
    .insert(users)
    .values({
      id,
      email: normalized,
      username: `${localPart || 'user'}-${suffix}`,
      passwordHash: createUnusablePasswordHash(),
      role: options.role ?? 'user',
      mustSetPassword: true,
    })
    .run();

  return id;
}

/**
 * Boot the real Express app against a fresh in-memory SQLite database.
 *
 * `db/client.ts` resolves `DATABASE_PATH` once, at import time, and every
 * route imports the module-level `db`. So the environment has to be set
 * *before* those modules load — hence the dynamic imports below.
 *
 * Node caches a module by its resolved specifier for the life of the module
 * registry, so without resetting that cache a second call would get the
 * already-loaded `db/client.js` (and its module-level `db`) back, carrying
 * over whatever the earlier tests wrote. `vi.resetModules()` forces both
 * modules to be re-evaluated, which is what makes the "fresh database"
 * guarantee below true for every call, not just the first one in a file.
 *
 * Call this from a test file that does not otherwise import the app.
 *
 * Usage:
 *
 *   const { app, db } = await createTestApp();
 *   await request(app).get('/api/health');
 */
export async function createTestApp(): Promise<{ app: Express; db: AppDatabase }> {
  process.env.DATABASE_PATH = ':memory:';
  process.env.NODE_ENV = 'test';
  // Keep the dev fallback out of the way so auth behaviour under test is real.
  delete process.env.DEV_USER_ID;

  vi.resetModules();

  const { db, runMigrations } = await import('../db/client.js');
  const { createApp } = await import('../app.js');

  runMigrations(db);

  return { app: createApp(), db };
}
