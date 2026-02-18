import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import fs from 'fs';
import * as schema from './schema.js';

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'dev-data', 'time-keeper.db');

// Ensure the directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

/**
 * Run Drizzle migrations from the ./drizzle directory.
 * Called once at server startup.
 */
export function runMigrations(): void {
  const migrationsFolder = path.join(import.meta.dirname, '..', '..', 'drizzle');
  migrate(db, { migrationsFolder });
  console.log('Database migrations applied.');
}

