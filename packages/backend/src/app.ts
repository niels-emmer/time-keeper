import express from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from './middleware/auth.js';
import { protectBrowserMutations } from './middleware/browserMutationProtection.js';
import { protectCsrf } from './lib/csrf.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authPublicRouter, authSessionRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { categoriesRouter } from './routes/categories.js';
import { timerRouter } from './routes/timer.js';
import { entriesRouter } from './routes/entries.js';
import { summaryRouter } from './routes/summary.js';
import { infoRouter } from './routes/info.js';
import { settingsRouter } from './routes/settings.js';
import { tokensRouter } from './routes/tokens.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  // Trust exactly two reverse-proxy hops (finding M-4): Nginx Proxy Manager on
  // the host, then the frontend nginx container (packages/frontend/nginx.conf),
  // before a request reaches this backend. Both hops append to
  // X-Forwarded-For (`$proxy_add_x_forwarded_for`), so a real request arrives as
  //
  //   X-Forwarded-For: <client>, <NPM>
  //   socket peer:     <frontend nginx>
  //
  // `trust proxy` counts hops outward from the socket, so 2 resolves `req.ip`
  // to <client> and gives express-rate-limit a genuine per-client key. The
  // exact count also means a leading, client-supplied X-Forwarded-For entry is
  // ignored: it sits further left than the two trusted hops and never becomes
  // req.ip.
  //
  // Do not raise this to `true` or to a larger number — that trusts arbitrary
  // client-supplied entries and lets a caller rotate their rate-limit identity
  // by spoofing the header.
  app.set('trust proxy', 2);

  app.use(express.json());

  // Rate limiting (finding M-4). Mounted before the health route on purpose
  // (P1-5): the unauthenticated health endpoint is reachable without auth, so
  // it must not be a free amplifier. The Docker healthcheck runs once every
  // 30 s (2 req/min) — two orders of magnitude below the 120/min budget — so
  // putting it under the limiter does not break the container healthcheck.
  //
  // express-rate-limit 8 (was 7): the options below use the v8 names —
  // `limit` (v7's `max` still works but is deprecated) and explicit
  // `ipv6Subnet`. v8 also keys IPv6 clients by subnet rather than by full
  // address: 56 is the library default and is stated here on purpose, because
  // it is a security property, not a detail. Two addresses inside one /56 share
  // a bucket, so an attacker holding a /56 cannot mint a fresh counter per
  // address; the cost is that unrelated clients under the same /56 share the
  // 120/min budget, which is irrelevant at this app's traffic. IPv4 is keyed
  // per address. `app.test.ts` pins both behaviours.
  const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 120,
    ipv6Subnet: 56,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  // Health check — no auth required (used by Docker healthcheck and manual
  // verification). Reports the same build version as GET /api/info: the
  // docker-entrypoint exports APP_VERSION from /app/VERSION, with `dev` as the
  // fallback outside a built image (finding L-1).
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: process.env.APP_VERSION ?? 'dev' });
  });

  // Public auth surface: login and status must work with no session. Mounted
  // before the global guard; `/login` is one of the CSRF-exempt public paths.
  app.use('/api/auth', authPublicRouter);

  // All other API routes require auth
  app.use('/api', authMiddleware);
  app.use('/api', protectBrowserMutations);
  // CSRF double-submit (D4). Mounted centrally so no mutating route can forget
  // it; it applies to session-authenticated requests and exempts bearer/header
  // callers that carry no ambient cookie.
  app.use('/api', protectCsrf);
  // Session-scoped auth surface: logout, logout-all, me. It sits behind the
  // guard and the CSRF middleware on purpose.
  app.use('/api/auth', authSessionRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/timer', timerRouter);
  app.use('/api/entries', entriesRouter);
  app.use('/api/summary', summaryRouter);
  app.use('/api/info', infoRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/tokens', tokensRouter);
  // Admin surface (Phase C carries only invite issuance; the rest is Phase E).
  // `requireAdmin` answers 404 for non-admins, so the path stays undiscoverable.
  app.use('/api/admin', adminRouter);

  app.use(errorHandler);

  return app;
}
