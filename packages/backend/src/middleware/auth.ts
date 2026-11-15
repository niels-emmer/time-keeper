import { createHash } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiTokens, type SessionRow, type UserRow } from '../db/schema.js';
import { isTokenExpired } from '../lib/apiTokenExpiry.js';
import {
  getAuthMode,
  modeAllowsProxyHeaders,
  modeAllowsSessions,
} from '../lib/config.js';
import { isTrustedProxyPeer } from '../lib/proxyTrust.js';
import { isSessionFresh, readSessionCookie, verifySession } from '../lib/session.js';
import { ensureProxyUser, findUserById } from '../services/userService.js';

export { isSecureRequest, isTrustedProxyPeer } from '../lib/proxyTrust.js';

declare global {
  namespace Express {
    interface Request {
      /** `users.id` — never the email. Every user-scoped table keys on this. */
      userId: string;
      /** The account's email, for display surfaces such as `GET /api/info`. */
      userEmail: string;
      userRole: 'user' | 'admin';
      /** How the request was authenticated. */
      authMethod: 'header' | 'token' | 'session';
      /** Present only when `authMethod === 'session'`. */
      authSession?: SessionRow;
    }
  }
}

export interface AuthContext {
  userId: string;
  userEmail: string;
  userRole: 'user' | 'admin';
  authMethod: 'header' | 'token' | 'session';
  session?: SessionRow;
  /** The resolved account row, so callers need not look it up again. */
  user: UserRow;
}

export function isTrustedProxyRequest(req: Request): boolean {
  // Layer 1 (C-1): identity headers may only arrive from a proxy network we
  // control. A public peer can present any header it likes, including a stolen
  // or guessed X-Internal-Token, so the peer check comes first and applies in
  // every environment.
  if (!isTrustedProxyPeer(req)) {
    return false;
  }

  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  const proxySecret = process.env.INTERNAL_PROXY_SECRET;
  if (!proxySecret) {
    return false;
  }

  return req.headers['x-internal-token'] === proxySecret;
}

function contextFor(user: {
  id: string;
  email: string;
  role: 'user' | 'admin';
}): Pick<AuthContext, 'userId' | 'userEmail' | 'userRole'> {
  return {
    userId: user.id,
    userEmail: user.email,
    userRole: user.role === 'admin' ? 'admin' : 'user',
  };
}

function attachUser(req: Request, context: AuthContext): void {
  req.userId = context.userId;
  req.userEmail = context.userEmail;
  req.userRole = context.userRole;
  req.authMethod = context.authMethod;
  req.authSession = context.session;
}

/**
 * Resolve the identity behind a request, or `null`.
 *
 * Shared by `requireAuth` and the public `GET /api/auth/status` endpoint so the
 * two can never disagree about who is signed in. It never writes a response.
 *
 * Paths, in order (plan A4):
 *
 * 1. `Authorization: Bearer <token>` — looked up by SHA-256 in `api_tokens`,
 *    which migration 0011 has already remapped onto `users.id` (Q25). Used by
 *    the macOS app on the api.* subdomain. An invalid bearer token is rejected
 *    outright and never falls through to another path, so a header cannot be
 *    used to rescue a bad token.
 *
 * 2. Session cookie (`tk_session`) — only when `AUTH_MODE` includes local
 *    sessions (`local` | `hybrid`). Server-side and revocable.
 *
 * 3. `X-authentik-email` — only when `AUTH_MODE` includes the proxy path
 *    (`proxy` | `hybrid`), and only from a trusted peer carrying the internal
 *    proxy secret in production. The email is resolved to `users.id`; an email
 *    with no account yet is provisioned on first sight, which is how accounts
 *    appeared before Phase A.
 *
 * 4. `DEV_USER_ID` — development only, and only in `AUTH_MODE=proxy` (Q21). In
 *    `local` mode local development uses the real login flow instead.
 *
 * Behaviour for existing proxy users is unchanged: the same header
 * authenticates the same person, against the same rows.
 */
export function authenticateRequest(req: Request): AuthContext | null {
  const mode = getAuthMode();

  // --- Path 1: Bearer token ---
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    if (rawToken.length > 0) {
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const row = db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.tokenHash, tokenHash))
        .get();

      if (!row || isTokenExpired(row.expiresAt)) {
        return null;
      }

      const user = findUserById(row.userId);
      if (!user || user.disabled) {
        return null;
      }

      // Update last_used_at asynchronously — don't block the request
      setImmediate(() => {
        try {
          db.update(apiTokens)
            .set({ lastUsedAt: new Date().toISOString() })
            .where(eq(apiTokens.id, row.id))
            .run();
        } catch {
          // Non-critical; silently ignore update failures
        }
      });

      return { ...contextFor(user), authMethod: 'token', user };
    }
  }

  // --- Path 2: session cookie ---
  if (modeAllowsSessions(mode)) {
    const rawSessionId = readSessionCookie(req);
    if (rawSessionId) {
      const verified = verifySession(rawSessionId);
      if (verified) {
        return {
          ...contextFor(verified.user),
          authMethod: 'session',
          session: verified.session,
          user: verified.user,
        };
      }

      // A present-but-invalid session cookie is not an error on its own: in
      // hybrid mode the proxy header may still authenticate the request. It is
      // cleared rather than reported so an expired session does not wedge the
      // browser. In local mode there is no fallback and the 401 below applies.
    }
  }

  // --- Path 3: Authentik header ---
  // Only trusted when BOTH of these hold:
  //
  //   1. The TCP peer is a proxy network we control (loopback/private or an
  //      explicit TRUSTED_PROXY_CIDRS entry). This blocks the direct-to-backend
  //      half of C-1: without it, a caller that reaches the backend from a
  //      public address can mint an identity by sending X-authentik-email. (The
  //      other half — a published frontend nginx — is fixed by not publishing
  //      :80 at all, because the backend would then see nginx's private address
  //      as the peer.)
  //   2. The request carries the internal proxy secret — a shared secret set
  //      by the frontend nginx on every proxied request (nginx.conf:
  //      proxy_set_header X-Internal-Token "<secret>"). This ensures that even
  //      if the api.* NPM proxy host is misconfigured and fails to strip
  //      Authentik headers, an external caller still cannot forge
  //      X-authentik-email to bypass token auth. The secret is set via the
  //      INTERNAL_PROXY_SECRET env var.
  //
  // In production, the header path is fail-closed: if the peer is not trusted,
  // or INTERNAL_PROXY_SECRET is missing/mismatched, X-authentik-email is
  // ignored.
  const headerUser = req.headers['x-authentik-email'] as string | undefined;
  if (headerUser && modeAllowsProxyHeaders(mode) && isTrustedProxyRequest(req)) {
    const { user } = ensureProxyUser(headerUser);
    if (user.disabled) {
      return null;
    }

    return { ...contextFor(user), authMethod: 'header', user };
  }

  // --- Path 4: Dev fallback (non-production, AUTH_MODE=proxy only) ---
  if (process.env.NODE_ENV !== 'production' && mode === 'proxy' && process.env.DEV_USER_ID) {
    const { user } = ensureProxyUser(process.env.DEV_USER_ID);
    return { ...contextFor(user), authMethod: 'header', user };
  }

  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const context = authenticateRequest(req);
  if (!context) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  attachUser(req, context);
  next();
}

/**
 * Backwards-compatible name. `authMiddleware` was the pre-Phase-A entry point;
 * every route and test that imported it keeps working against `requireAuth`.
 */
export const authMiddleware = requireAuth;

/**
 * Restrict a route to administrators.
 *
 * Non-admins get **404**, not 403 (plan §5): a 403 confirms that an admin
 * surface exists at that path, which is exactly the discovery signal a
 * non-admin should not get.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.userRole !== 'admin') {
    res.status(404).json({ error: 'Not Found' });
    return;
  }

  next();
}

/**
 * Gate for API-token management (Q9, I-009).
 *
 * Phase B makes token management work under local auth, where there is no
 * Authentik header. The rule is:
 *
 *   * Bearer token → **403**. A machine credential must never mint, list or
 *     revoke tokens (privilege escalation / lockout).
 *   * Proxy identity header → allowed. This is today's interactive browser
 *     path and keeps working in `proxy` and `hybrid` modes.
 *   * Session → allowed only when the session was established within the last
 *     five minutes (Q17). A stale session gets a 403 with
 *     `code: 'reauthentication_required'`; Phase C adds the re-auth prompt that
 *     refreshes it.
 */
export function requireTokenManagementAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.authMethod === 'token') {
    res.status(403).json({ error: 'Token management requires interactive (browser) authentication' });
    return;
  }

  if (req.authMethod === 'header') {
    next();
    return;
  }

  if (req.authMethod === 'session') {
    if (!req.authSession || !isSessionFresh(req.authSession)) {
      res.status(403).json({
        error: 'Re-authentication required',
        code: 'reauthentication_required',
      });
      return;
    }

    next();
    return;
  }

  res.status(403).json({ error: 'Token management requires interactive (browser) authentication' });
}

/**
 * Gate for sensitive account actions (Q17, Phase C).
 *
 * Q17 names the actions: password change, token minting, role change, account
 * deletion, MFA disable. All of them require a credential check within the last
 * five minutes, so a session left open on an unlocked laptop cannot be used to
 * take the account over.
 *
 *   * Bearer token → **403**. A machine credential must never perform an
 *     account-lifecycle action.
 *   * Proxy identity header → allowed. That path is authenticated by Authentik
 *     on every request; there is no long-lived session to go stale.
 *   * Session → allowed only when established within the last five minutes,
 *     otherwise 403 with `code: 'reauthentication_required'`, which the Account
 *     screen turns into "sign in again" copy.
 */
export function requireFreshSession(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.authMethod === 'token') {
    res.status(403).json({
      error: 'This action requires interactive (browser) authentication',
      code: 'interactive_authentication_required',
    });
    return;
  }

  if (req.authMethod === 'header') {
    next();
    return;
  }

  if (req.authMethod === 'session') {
    if (!req.authSession || !isSessionFresh(req.authSession)) {
      res.status(403).json({
        error: 'Re-authentication required',
        code: 'reauthentication_required',
      });
      return;
    }

    next();
    return;
  }

  res.status(403).json({
    error: 'This action requires interactive (browser) authentication',
    code: 'interactive_authentication_required',
  });
}

/**
 * Deprecated alias retained for importers that still expect the Phase A name.
 * Behaviour is identical to `requireTokenManagementAuth` for header and token
 * callers; the session path is new in Phase B.
 */
export const requireHeaderAuth = requireTokenManagementAuth;
