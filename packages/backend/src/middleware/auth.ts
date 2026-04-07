import { createHash } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiTokens } from '../db/schema.js';

declare global {
  namespace Express {
    interface Request {
      userId: string;
      /** How the request was authenticated. 'header' = Authentik proxy header; 'token' = Bearer API token. */
      authMethod: 'header' | 'token';
    }
  }
}

/**
 * Extract the authenticated user from the request.
 *
 * Auth is checked in this order:
 *
 * 1. Bearer token (Authorization: Bearer <token>)
 *    - SHA-256 hash of the token is looked up in api_tokens.
 *    - Used by the native macOS app via the api.* subdomain (no Authentik in the path).
 *    - Token management endpoints require authMethod === 'header' — a token cannot create tokens.
 *
 * 2. X-authentik-email header (set by Authentik's embedded outpost via NPM forward auth)
 *    - Primary auth path for the PWA.
 *
 * 3. DEV_USER_ID env var (only when NODE_ENV !== 'production')
 *    - Development convenience — never active in production.
 *
 * Returns 401 if none of the above yield a user in production.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
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

      if (row) {
        req.userId = row.userId;
        req.authMethod = 'token';
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
        next();
        return;
      }

      // Token provided but not found — reject immediately (don't fall through to header auth)
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  // --- Path 2: Authentik header ---
  const headerUser = req.headers['x-authentik-email'] as string | undefined;
  if (headerUser) {
    req.userId = headerUser;
    req.authMethod = 'header';
    next();
    return;
  }

  // --- Path 3: Dev fallback (non-production only) ---
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_USER_ID) {
    req.userId = process.env.DEV_USER_ID;
    req.authMethod = 'header';
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Middleware that restricts an endpoint to Authentik-header-authenticated requests only.
 * Bearer-token callers receive 403 — a token cannot manage tokens.
 *
 * Apply after authMiddleware on any route that manages api_tokens.
 */
export function requireHeaderAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.authMethod !== 'header') {
    res.status(403).json({ error: 'Token management requires interactive (browser) authentication' });
    return;
  }
  next();
}
