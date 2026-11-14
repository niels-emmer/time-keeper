/**
 * Phase A migration dry run — prints the evidence table for the PR / release.
 *
 *   yarn workspace @time-keeper/backend verify:migration
 *
 * Builds a seeded pre-Phase-A database (schema at migration 0010, several
 * Authentik-email owners, entries, settings, tokens, a monthly goal), takes a
 * WAL-safe backup, migrates a *copy* of it, and prints what changed — which must
 * be nothing but the identity column. Exits non-zero on any difference.
 *
 * This is the printed counterpart of `src/db/migration.phaseA.test.ts`; both
 * share `src/test/phaseAFixture.ts`, so the procedure in
 * `docs/operations/migration-phase-a.md` cannot drift from what is asserted.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DRIZZLE_DIR,
  createLegacySeededDatabase,
  foreignKeyViolations,
  indexNames,
  migrateToHead,
  snapshotLegacy,
  snapshotMigrated,
  tableCounts,
  vacuumInto,
} from '../src/test/phaseAFixture.js';

const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`);
  } else {
    failures += 1;
    console.log(`  ${RED}✗ ${label}${detail ? ` — ${detail}` : ''}${RESET}`);
  }
}

function heading(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}`);
}

function normalize(snapshot: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(snapshot).map(([key, value]) => [key.trim().toLowerCase(), value])
  );
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-phase-a-verify-'));
const legacyPath = path.join(workDir, 'time-keeper-legacy.db');
const backupPath = path.join(workDir, 'time-keeper-backup.db');
const migratedPath = path.join(workDir, 'time-keeper-migrated.db');

try {
  console.log(`${BOLD}Phase A migration dry run${RESET}`);
  console.log(`${DIM}migrations: ${DRIZZLE_DIR}${RESET}`);
  console.log(`${DIM}workdir:    ${workDir}${RESET}`);

  heading('1. Seed a pre-Phase-A database (schema at 0010, email-keyed)');
  createLegacySeededDatabase(legacyPath);
  const beforeOwnership = snapshotLegacy(legacyPath);
  const beforeCounts = tableCounts(legacyPath);

  for (const [email, totals] of Object.entries(beforeOwnership)) {
    console.log(
      `  ${email.padEnd(28)} categories=${String(totals.categories).padEnd(2)} ` +
        `entries=${String(totals.entries).padEnd(2)} open=${totals.openEntries} ` +
        `closedMinutes=${String(totals.closedMinutes).padEnd(4)} tokens=${totals.tokens} ` +
        `goals=${totals.goals} settings=${totals.settings ?? '-'}`
    );
  }

  heading('2. WAL-safe backup (VACUUM INTO)');
  vacuumInto(legacyPath, backupPath);
  const backupBytes = fs.statSync(backupPath).size;
  check('backup written', backupBytes > 0, `${(backupBytes / 1024).toFixed(1)} KiB`);
  check(
    'backup answers the same questions as the original',
    JSON.stringify(normalize(snapshotLegacy(backupPath))) ===
      JSON.stringify(normalize(beforeOwnership))
  );

  heading('3. Migrate a copy — never the original');
  fs.copyFileSync(backupPath, migratedPath);
  migrateToHead(migratedPath);
  const afterCounts = tableCounts(migratedPath);
  const afterOwnership = snapshotMigrated(migratedPath);

  const preservedTables = [
    'categories',
    'time_entries',
    'user_settings',
    'api_tokens',
    'monthly_project_goals',
  ];

  heading('4. Row counts before vs after');
  for (const table of preservedTables) {
    check(
      `${table}`,
      afterCounts[table] === beforeCounts[table],
      `${beforeCounts[table]} -> ${afterCounts[table]}`
    );
  }
  check('users created', afterCounts.users === Object.keys(beforeOwnership).length, String(afterCounts.users));
  for (const empty of ['sessions', 'recovery_codes', 'invites', 'auth_events']) {
    check(`${empty} created empty`, afterCounts[empty] === 0, String(afterCounts[empty]));
  }

  heading('5. Per-user totals before vs after (identity moved email -> users.id)');
  const normalizedBefore = normalize(beforeOwnership);
  const normalizedAfter = normalize(afterOwnership);
  const emails = Object.keys(normalizedAfter).sort();
  for (const email of emails) {
    const totals = normalizedAfter[email] as (typeof afterOwnership)[string];
    const expected = normalizedBefore[email] as (typeof afterOwnership)[string];
    check(email, JSON.stringify(totals) === JSON.stringify(expected), JSON.stringify(totals));
  }
  check(
    'no person gained or lost a row set',
    JSON.stringify(emails.map((email) => [email, normalizedBefore[email]])) ===
      JSON.stringify(emails.map((email) => [email, normalizedAfter[email]]))
  );

  heading('6. Integrity');
  check('no foreign-key violations', foreignKeyViolations(migratedPath).length === 0);
  const indexes = indexNames(migratedPath);
  for (const index of [
    'idx_users_email',
    'idx_users_username',
    'idx_categories_user_name',
    'idx_entries_one_open_per_user',
    'idx_api_tokens_hash',
    'idx_sessions_user',
  ]) {
    check(`index ${index}`, indexes.includes(index));
  }
  check('no leftover rebuild tables', indexes.every((name) => !name.startsWith('__new_')));
  check(
    're-running the migrator is a no-op',
    JSON.stringify((() => {
      migrateToHead(migratedPath);
      return tableCounts(migratedPath);
    })()) === JSON.stringify(afterCounts)
  );
  check(
    'the backup is still email-keyed and restorable',
    JSON.stringify(normalize(snapshotLegacy(backupPath))) === JSON.stringify(normalizedBefore)
  );

  heading('Result');
  if (failures === 0) {
    console.log(`${GREEN}${BOLD}PASS${RESET} — every row and every per-user total survived the migration.`);
  } else {
    console.log(`${RED}${BOLD}FAIL${RESET} — ${failures} check(s) failed. Do not migrate production.`);
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
