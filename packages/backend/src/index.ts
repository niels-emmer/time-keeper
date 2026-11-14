import { runMigrations } from './db/client.js';
import { createApp } from './app.js';
import { modeAllowsSessions, validateStartupConfig } from './lib/config.js';
import { ensureAdminFromEmail, seedDevAdmin } from './services/userService.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const isProduction = process.env.NODE_ENV === 'production';

// A5: refuse to boot in production without the secrets the auth subsystem
// needs; generate ephemeral ones with a loud warning everywhere else.
const config = validateStartupConfig();

runMigrations();

// Q2 / Q18: the first administrator is named by ADMIN_EMAIL. Production fails
// to boot if it is missing or matches no user; development warns.
const adminBootstrap = ensureAdminFromEmail(process.env.ADMIN_EMAIL, { isProduction });
if (adminBootstrap?.promoted) {
  console.log(`[auth] promoted ${adminBootstrap.user.email} to role=admin from ADMIN_EMAIL`);
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
