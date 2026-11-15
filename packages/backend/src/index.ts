import { runMigrations } from './db/client.js';
import { createApp } from './app.js';
import { modeAllowsSessions, validateStartupConfig } from './lib/config.js';
import { pruneAuthAttempts } from './services/authLockout.js';
import { ensureAdminFromEmail, seedDevAdmin } from './services/userService.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const isProduction = process.env.NODE_ENV === 'production';

// A5: refuse to boot in production without the secrets the auth subsystem
// needs; generate ephemeral ones with a loud warning everywhere else.
const config = validateStartupConfig();

runMigrations();

// Q12-consistent retention for `auth_attempts`: an install that has been idle
// for months starts clean, and the per-IP funnel keeps it trimmed in a
// long-running process. Active lockouts are never removed (see the function).
pruneAuthAttempts();

// Q2 / Q18: the first administrator is named by ADMIN_EMAIL. Production fails
// to boot if it is missing, or if it matches no account on a database that
// already has accounts. On an empty database the first admin is created (D-033);
// development warns and relies on the seeded dev admin.
const adminBootstrap = ensureAdminFromEmail(process.env.ADMIN_EMAIL, { isProduction });
if (adminBootstrap?.promoted && !adminBootstrap.bootstrapResetCode) {
  console.log(`[auth] promoted ${adminBootstrap.user.email} to role=admin from ADMIN_EMAIL`);
}

// Phase F: a fresh production database has no account for ADMIN_EMAIL to match,
// so boot creates the first administrator and prints a one-time reset code.
// This is not a password: it is single-use, expires in 60 minutes, and the
// operator chooses the password at /reset. Printed loudly and once because
// losing it means there is no way into a new deployment.
if (adminBootstrap?.bootstrapResetCode) {
  console.log(
    [
      '',
      '  ────────────────────────────────────────────────────────────────',
      '  FIRST ADMINISTRATOR CREATED',
      `    email:      ${adminBootstrap.user.email}`,
      `    reset code: ${adminBootstrap.bootstrapResetCode.code}`,
      `    expires:    ${adminBootstrap.bootstrapResetCode.expiresAt}`,
      '',
      '  Open /reset?code=<the code above>, or open /reset and paste it, then',
      '  choose the password. The code works once and is not printed again.',
      '  ────────────────────────────────────────────────────────────────',
      '',
    ].join('\n')
  );
}

// Q21: in local/hybrid development the real login flow is the path under
// exercise, so there must be an account with a usable password. Created once;
// an existing dev admin is never reset or re-printed.
if (!isProduction && modeAllowsSessions(config.authMode)) {
  seedDevAdmin({ password: process.env.DEV_ADMIN_PASSWORD });
}

const app = createApp();

app.listen(PORT, () => {
  console.log(`Time-keeper backend running on port ${PORT}`);
});
