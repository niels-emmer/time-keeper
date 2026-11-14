import { randomBytes } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { readCookie } from './cookies.js';
import { timingSafeEqualString } from './password.js';
import { isSecureRequest } from './proxyTrust.js';
import { readSessionCookie, SESSION_ABSOLUTE_MS } from './session.js';

/**
 * CSRF double-submit protection (D4, Phase B).
 *
 * The session cookie is ambient: a browser sends it on any cross-site request,
 * including a form POST the user did not intend. Double-submit defeats that by
 * requiring a second, per-session secret that a cross-origin page cannot read:
 *
 *   * `tk_csrf` cookie — deliberately **not** `HttpOnly`, so same-origin JS can
 *     read it; `SameSite=Lax` like the session cookie.
 *   * `X-CSRF-Token` request header — echoed by the client.
 *
 * The middleware compares the two in constant time on every non-GET `/api`
 * route. It is mounted centrally in `app.ts`, not per route, so a new mutating
 * route cannot forget it.
 *
 * Bearer-token and proxy-header requests are not cookie-authenticated in the
 * browser sense and are exempt — but if a session cookie is present at all, the
 * token is still required, so a hybrid deployment cannot be tricked by
 * presenting both an ambient cookie and a header.
 */

export const CSRF_COOKIE = 'tk_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Paths that are public by design and therefore cannot carry the cookie yet. */
const PUBLIC_PATHS = new Set(['/auth/login', '/auth/status']);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function csrfCookieOptions(req: Request) {
  return {
    httpOnly: false,
    secure: isSecureRequest(req),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_ABSOLUTE_MS,
  };
}

export function setCsrfCookie(res: Response, req: Request, token: string): void {
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions(req));
}

export function clearCsrfCookie(res: Response, req: Request): void {
  const { maxAge: _maxAge, ...options } = csrfCookieOptions(req);
  res.clearCookie(CSRF_COOKIE, options);
}

export function readCsrfCookie(req: Request): string | undefined {
  return readCookie(req, CSRF_COOKIE);
}

function headerToken(req: Request): string | undefined {
  const raw = req.headers[CSRF_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.split(',')[0]?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** True when the presented header matches the presented cookie, in constant time. */
export function isValidCsrfPair(cookieValue: string | undefined, headerValue: string | undefined): boolean {
  if (!cookieValue || !headerValue) {
    return false;
  }
  return timingSafeEqualString(cookieValue, headerValue);
}

/**
 * True when this request is exempt from CSRF checking: a safe method, or one of
 * the public auth endpoints that is mounted before authentication.
 */
export function isCsrfExempt(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return true;
  }

  const path = req.path.replace(/\/+$/, '') || '/';
  return PUBLIC_PATHS.has(path);
}

export function protectCsrf(req: Request, res: Response, next: NextFunction): void {
  if (isCsrfExempt(req)) {
    next();
    return;
  }

  const hasSessionCookie = readSessionCookie(req) !== undefined;
  if (req.authMethod !== 'session' && !hasSessionCookie) {
    // Bearer token or trusted proxy header: not ambient browser credentials.
    next();
    return;
  }

  if (!isValidCsrfPair(readCsrfCookie(req), headerToken(req))) {
    res.status(403).json({ error: 'Invalid CSRF token' });
    return;
  }

  next();
}
