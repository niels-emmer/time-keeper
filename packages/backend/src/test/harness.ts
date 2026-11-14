import type { Express } from 'express';
import { vi } from 'vitest';
import type { AppDatabase } from '../db/client.js';

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
