import { Router } from 'express';
import { z } from 'zod';
import { getAuthMode, modeAllowsSessions } from '../lib/config.js';
import { clearCsrfCookie, setCsrfCookie } from '../lib/csrf.js';
import {
  clearSessionCookie,
  readSessionCookie,
  revokeAllSessions,
  revokeSession,
  setSessionCookie,
} from '../lib/session.js';
import { authenticateRequest } from '../middleware/auth.js';
import {
  findUserById,
  loginWithPassword,
  recordAuthEvent,
  serializeUser,
} from '../services/authService.js';

/**
 * Authentication routes (Phase B, plan §5).
 *
 * Two routers on purpose:
 *
 *   * `authPublicRouter` — mounted **before** the global `requireAuth`, because
 *     login and status must be reachable with no session. Their mutating
 *     endpoint (`/login`) is one of the CSRF-exempt public paths.
 *   * `authSessionRouter` — mounted **after** `requireAuth` and `protectCsrf`,
 *     so logout/me inherit both the session identity and the double-submit
 *     check without repeating them per route.
 */

const IDENTIFIER_MAX_LENGTH = 320; // enough for the longest valid email
const PASSWORD_MAX_LENGTH = 1024; // bound the scrypt input

const loginSchema = z
  .object({
    /** Canonical field: username or email, one string (Q5). */
    identifier: z.string().trim().min(1).max(IDENTIFIER_MAX_LENGTH).optional(),
    /** Accepted aliases so a client may post either name explicitly. */
    username: z.string().trim().min(1).max(IDENTIFIER_MAX_LENGTH).optional(),
    email: z.string().trim().min(1).max(IDENTIFIER_MAX_LENGTH).optional(),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .refine((value) => Boolean(value.identifier ?? value.username ?? value.email), {
    message: 'identifier, username or email is required',
    path: ['identifier'],
  });

function noStore(res: import('express').Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

function requestIp(req: import('express').Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

export const authPublicRouter = Router();

authPublicRouter.use((_req, res, next) => {
  noStore(res);
  next();
});

/**
 * POST /api/auth/login
 *
 * Username or email + password. Every credential failure returns the same 401
 * body; lockout returns 429 with `Retry-After`. A correct password for an
 * MFA-enabled account returns `200 { status: 'mfa_required' }` and deliberately
 * sets **no session cookie** — Phase D adds the completion endpoint.
 */
authPublicRouter.post('/login', (req, res, next) => {
  try {
    if (!modeAllowsSessions(getAuthMode())) {
      // Local login does not exist in proxy mode. 404 keeps the surface
      // undiscoverable rather than advertising a disabled feature.
      res.status(404).json({ error: 'Not Found' });
      return;
    }

    const payload = loginSchema.parse(req.body);
    const identifier = (payload.identifier ?? payload.username ?? payload.email) as string;

    const outcome = loginWithPassword({
      identifier,
      password: payload.password,
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
      existingSessionId: readSessionCookie(req),
    });

    if (outcome.status === 'rate_limited') {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(outcome.retryAfterMs / 1000))));
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return;
    }

    if (outcome.status === 'invalid') {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    if (outcome.status === 'mfa_required') {
      res.status(200).json({ status: 'mfa_required' });
      return;
    }

    setSessionCookie(res, req, outcome.session.id);
    setCsrfCookie(res, req, outcome.csrfToken);

    res.status(200).json({
      status: 'ok',
      user: serializeUser(outcome.user),
      csrfToken: outcome.csrfToken,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/status
 *
 * Public by design: the SPA calls it before it knows whether anyone is signed
 * in. It resolves the session (or, in proxy mode, the identity header) through
 * the same `authenticateRequest` the guards use, so it cannot disagree with
 * them.
 */
authPublicRouter.get('/status', (req, res, next) => {
  try {
    const mode = getAuthMode();
    const context = authenticateRequest(req);

    if (!context) {
      res.json({ authenticated: false, mode });
      return;
    }

    res.json({
      authenticated: true,
      mode,
      user: serializeUser(context.user),
    });
  } catch (error) {
    next(error);
  }
});

export const authSessionRouter = Router();

authSessionRouter.use((_req, res, next) => {
  noStore(res);
  next();
});

/** POST /api/auth/logout — revoke this session only. */
authSessionRouter.post('/logout', (req, res, next) => {
  try {
    const rawSessionId = readSessionCookie(req);
    if (rawSessionId) {
      revokeSession(rawSessionId);
    }

    clearSessionCookie(res, req);
    clearCsrfCookie(res, req);

    recordAuthEvent({
      userId: req.userId,
      kind: 'logout',
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** POST /api/auth/logout-all — revoke every session for the account. */
authSessionRouter.post('/logout-all', (req, res, next) => {
  try {
    const revoked = revokeAllSessions(req.userId);

    clearSessionCookie(res, req);
    clearCsrfCookie(res, req);

    recordAuthEvent({
      userId: req.userId,
      kind: 'logout_all',
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
      meta: { revoked },
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** GET /api/auth/me — the caller's own account summary, allowlist-serialised. */
authSessionRouter.get('/me', (req, res, next) => {
  try {
    const user = findUserById(req.userId);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    res.json({ user: serializeUser(user) });
  } catch (error) {
    next(error);
  }
});
