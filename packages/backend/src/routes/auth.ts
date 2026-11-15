import { Router } from 'express';
import { z } from 'zod';
import { getAuthMode, modeAllowsSessions } from '../lib/config.js';
import { clearCsrfCookie, generateCsrfToken, setCsrfCookie } from '../lib/csrf.js';
import { INVITE_INVALID_MESSAGE } from '../lib/invite.js';
import { PASSWORD_MAX_LENGTH, checkPasswordPolicy } from '../lib/passwordPolicy.js';
import {
  clearSessionCookie,
  createSession,
  hashSessionId,
  listSessions,
  readSessionCookie,
  revokeAllSessions,
  revokeSession,
  revokeSessionByIdHash,
  setSessionCookie,
} from '../lib/session.js';
import { authenticateRequest, requireFreshSession } from '../middleware/auth.js';
import {
  CONFIRM_MISMATCH_MESSAGE,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_TAKEN_MESSAGE,
  LAST_ADMIN_MESSAGE,
  NO_PASSWORD_MESSAGE,
  PASSWORD_INCORRECT_MESSAGE,
  USERNAME_IMMUTABLE_MESSAGE,
  USERNAME_TAKEN_MESSAGE,
  changePassword,
  deleteOwnAccount,
  updateProfile,
} from '../services/accountService.js';
import {
  findUserById,
  loginWithPassword,
  recordAuthEvent,
  serializeUser,
} from '../services/authService.js';
import { findUsableInvite, registerInvitedUser } from '../services/inviteService.js';
import { isValidUsername, normalizeEmail } from '../services/userService.js';

/**
 * Authentication routes (Phase B + Phase C, plan §5).
 *
 * Two routers on purpose:
 *
 *   * `authPublicRouter` — mounted **before** the global `requireAuth`, because
 *     login, status and invite acceptance must be reachable with no session.
 *     Their mutating endpoints are CSRF-exempt public paths, since no cookie
 *     pair can exist yet.
 *   * `authSessionRouter` — mounted **after** `requireAuth` and `protectCsrf`,
 *     so logout/me/password/sessions inherit both the session identity and the
 *     double-submit check without repeating them per route.
 */

const IDENTIFIER_MAX_LENGTH = 320; // enough for the longest valid email
const EMAIL_MAX_LENGTH = 320;

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

const emailField = z
  .string()
  .trim()
  .min(3)
  .max(EMAIL_MAX_LENGTH)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.');

const USERNAME_FORMAT_MESSAGE =
  'Usernames are 3–32 characters: lowercase letters, numbers, hyphens and underscores.';

const acceptInviteSchema = z.object({
  token: z.string().trim().min(1).max(512),
  email: emailField,
  username: z.string().trim().min(3).max(32),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
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

/**
 * POST /api/auth/accept-invite
 *
 * Public by design: whoever holds the invite link has no session yet.
 *
 * The invite is the only credential. Unknown, already-used and expired tokens
 * all produce the same 400 with the same message, so a stale link cannot be
 * probed for whether the account it created still exists. The role comes from
 * the invite row, never from the request body.
 */
authPublicRouter.post('/accept-invite', (req, res, next) => {
  try {
    if (!modeAllowsSessions(getAuthMode())) {
      // Invite acceptance signs a session, which does not exist in proxy mode.
      res.status(404).json({ error: 'Not Found' });
      return;
    }

    const payload = acceptInviteSchema.parse(req.body);
    const now = new Date();
    const ip = requestIp(req);
    const userAgent = req.get('user-agent') ?? null;

    const invite = findUsableInvite(payload.token, { now });
    if (!invite) {
      recordAuthEvent({ kind: 'invite_rejected', ip, userAgent });
      res.status(400).json({ error: INVITE_INVALID_MESSAGE, code: 'invite_invalid' });
      return;
    }

    const email = normalizeEmail(payload.email);
    if (invite.email && invite.email !== email) {
      // Only the invite holder can reach this, and they already know the link.
      recordAuthEvent({ kind: 'invite_rejected', ip, userAgent });
      res.status(400).json({
        error: 'This invitation was issued for a different email address.',
        code: 'invite_email_mismatch',
      });
      return;
    }

    const username = payload.username.trim().toLowerCase();
    if (!isValidUsername(username)) {
      res.status(400).json({ error: USERNAME_FORMAT_MESSAGE, code: 'username_invalid' });
      return;
    }

    const policy = checkPasswordPolicy(payload.password, { username, email });
    if (!policy.ok) {
      res.status(400).json({ error: policy.message, code: 'password_policy' });
      return;
    }

    // The unique indexes are what actually decide email/username collisions:
    // a check followed by an insert would leave a race window, so the service
    // maps the constraint violation to the same 409 instead of a 500.
    const outcome = registerInvitedUser({
      invite,
      email,
      username,
      password: payload.password,
      now,
    });

    if (outcome.status === 'invalid') {
      res.status(400).json({ error: INVITE_INVALID_MESSAGE, code: 'invite_invalid' });
      return;
    }

    if (outcome.status === 'email_taken') {
      res.status(409).json({ error: EMAIL_TAKEN_MESSAGE, code: 'email_taken' });
      return;
    }

    if (outcome.status === 'username_taken') {
      res.status(409).json({ error: USERNAME_TAKEN_MESSAGE, code: 'username_taken' });
      return;
    }

    const session = createSession({ userId: outcome.user.id, ip, userAgent, now });
    const csrfToken = generateCsrfToken();

    setSessionCookie(res, req, session.id);
    setCsrfCookie(res, req, csrfToken);

    recordAuthEvent(
      {
        userId: outcome.user.id,
        kind: 'invite_accepted',
        ip,
        userAgent,
        meta: { inviteId: invite.id, role: outcome.user.role },
      }
    );

    res.status(201).json({
      status: 'ok',
      user: serializeUser(outcome.user),
      csrfToken,
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

function hasOwnKey(body: unknown, key: string): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    Object.prototype.hasOwnProperty.call(body, key)
  );
}

const updateProfileSchema = z.object({
  displayName: z.string().max(DISPLAY_NAME_MAX_LENGTH).nullable().optional(),
  email: emailField.optional(),
});

/**
 * PATCH /api/auth/me — display name and email only.
 *
 * `username` is immutable (Q14). Any attempt to send it is **rejected**, not
 * ignored: silently dropping the field tells the client its change succeeded
 * when nothing changed, which is worse than an error. The rejection also
 * covers sending the current username, so a client cannot rely on
 * "send it back unchanged" semantics.
 */
authSessionRouter.patch('/me', (req, res, next) => {
  try {
    if (hasOwnKey(req.body, 'username')) {
      res.status(400).json({
        error: USERNAME_IMMUTABLE_MESSAGE,
        code: 'username_immutable',
      });
      return;
    }

    const payload = updateProfileSchema.parse(req.body ?? {});

    // In proxy mode the identity *is* the email header. Renaming the account's
    // email here would desynchronise it from what Authentik sends on the next
    // request, and the user's data would be stranded on a freshly provisioned
    // account. Refuse instead of losing their history.
    if (payload.email !== undefined && req.authMethod === 'header') {
      res.status(409).json({
        error: 'Your email address is managed by your identity provider.',
        code: 'email_managed_by_proxy',
      });
      return;
    }

    const outcome = updateProfile({
      userId: req.userId,
      displayName: payload.displayName,
      email: payload.email,
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
    });

    if (outcome.status === 'not_found') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (outcome.status === 'email_taken') {
      res.status(409).json({ error: EMAIL_TAKEN_MESSAGE, code: 'email_taken' });
      return;
    }

    res.json({ user: serializeUser(outcome.user) });
  } catch (error) {
    next(error);
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/**
 * POST /api/auth/password — current password + new password (Q17).
 *
 * Requires a credential check within the last five minutes. On success every
 * *other* session is revoked and the caller's own session id is rotated, so a
 * previously stolen cookie stops working the moment the password changes.
 */
authSessionRouter.post('/password', requireFreshSession, (req, res, next) => {
  try {
    const payload = changePasswordSchema.parse(req.body);

    const outcome = changePassword({
      userId: req.userId,
      currentPassword: payload.currentPassword,
      newPassword: payload.newPassword,
      currentSessionId: readSessionCookie(req),
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
    });

    switch (outcome.status) {
      case 'not_found':
        res.status(401).json({ error: 'Unauthorized' });
        return;
      case 'no_password':
        res.status(400).json({ error: NO_PASSWORD_MESSAGE, code: 'password_not_set' });
        return;
      case 'incorrect':
        res
          .status(400)
          .json({ error: PASSWORD_INCORRECT_MESSAGE, code: 'password_incorrect' });
        return;
      case 'unchanged':
        res.status(400).json({
          error: 'Choose a password you have not used on this account before.',
          code: 'password_unchanged',
        });
        return;
      case 'policy':
        res.status(400).json({ error: outcome.message, code: 'password_policy' });
        return;
      case 'ok':
        if (outcome.session) {
          setSessionCookie(res, req, outcome.session.id);
        }
        res.json({
          user: serializeUser(outcome.user),
          otherSessionsRevoked: outcome.otherSessionsRevoked,
        });
        return;
    }
  } catch (error) {
    next(error);
  }
});

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  confirmUsername: z.string().trim().min(1).max(64),
});

/**
 * DELETE /api/auth/me — hard self-delete (D6).
 *
 * Password re-entry plus the typed username are both required: the frontend
 * asks a human to confirm, and the API refuses to trust that alone. The last
 * administrator is refused outright, because an unadministrable instance means
 * a trip to the database.
 */
authSessionRouter.delete('/me', requireFreshSession, (req, res, next) => {
  try {
    const payload = deleteAccountSchema.parse(req.body);

    const outcome = deleteOwnAccount({
      userId: req.userId,
      password: payload.password,
      confirmUsername: payload.confirmUsername,
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
    });

    switch (outcome.status) {
      case 'not_found':
        res.status(401).json({ error: 'Unauthorized' });
        return;
      case 'confirm_mismatch':
        res.status(400).json({ error: CONFIRM_MISMATCH_MESSAGE, code: 'confirm_mismatch' });
        return;
      case 'no_password':
        res.status(400).json({ error: NO_PASSWORD_MESSAGE, code: 'password_not_set' });
        return;
      case 'incorrect':
        res
          .status(400)
          .json({ error: PASSWORD_INCORRECT_MESSAGE, code: 'password_incorrect' });
        return;
      case 'last_admin':
        res.status(409).json({ error: LAST_ADMIN_MESSAGE, code: 'last_admin' });
        return;
      case 'ok':
        clearSessionCookie(res, req);
        clearCsrfCookie(res, req);
        res.status(204).end();
        return;
    }
  } catch (error) {
    next(error);
  }
});

/**
 * Session inventory (D4, Q7/Q11).
 *
 * Scoped to the caller's own account by the query, and the handle is the stored
 * SHA-256 of the session id — never the cookie value, which the server does not
 * keep after issuance. A machine credential is refused: listing devices is an
 * interactive surface.
 */
authSessionRouter.get('/sessions', (req, res, next) => {
  try {
    if (req.authMethod === 'token') {
      res.status(403).json({
        error: 'This action requires interactive (browser) authentication',
        code: 'interactive_authentication_required',
      });
      return;
    }

    const rawSessionId = readSessionCookie(req);
    const currentHash = rawSessionId ? hashSessionId(rawSessionId) : null;

    const rows = listSessions(req.userId);

    res.json({
      currentSessionId: currentHash,
      sessions: rows.map((row) => ({
        id: row.idHash,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        userAgent: row.userAgent ?? null,
        ip: row.ip ?? null,
        current: currentHash !== null && row.idHash === currentHash,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/auth/sessions/others — sign out every other device.
 *
 * Declared before `/sessions/:id` so "others" is never captured as an id.
 */
authSessionRouter.delete('/sessions/others', (req, res, next) => {
  try {
    if (req.authMethod === 'token') {
      res.status(403).json({
        error: 'This action requires interactive (browser) authentication',
        code: 'interactive_authentication_required',
      });
      return;
    }

    const rawSessionId = readSessionCookie(req);
    const revoked = revokeAllSessions(
      req.userId,
      rawSessionId ? { exceptRawId: rawSessionId } : {}
    );

    recordAuthEvent({
      userId: req.userId,
      kind: 'session_revoked',
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
      meta: { scope: 'others', revoked },
    });

    res.json({ revoked });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/auth/sessions/:id — revoke one of the caller's own sessions.
 *
 * A session owned by someone else is indistinguishable from one that does not
 * exist: both are 404, so this cannot be used to enumerate other users'
 * sessions (Q11 — no cross-user session administration).
 */
authSessionRouter.delete('/sessions/:id', (req, res, next) => {
  try {
    if (req.authMethod === 'token') {
      res.status(403).json({
        error: 'This action requires interactive (browser) authentication',
        code: 'interactive_authentication_required',
      });
      return;
    }

    const rawSessionId = readSessionCookie(req);
    const currentHash = rawSessionId ? hashSessionId(rawSessionId) : null;
    const idHash = req.params.id;

    if (!revokeSessionByIdHash(req.userId, idHash)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const wasCurrent = currentHash !== null && currentHash === idHash;
    if (wasCurrent) {
      clearSessionCookie(res, req);
      clearCsrfCookie(res, req);
    }

    recordAuthEvent({
      userId: req.userId,
      kind: 'session_revoked',
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
      meta: { scope: 'one', current: wasCurrent },
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
