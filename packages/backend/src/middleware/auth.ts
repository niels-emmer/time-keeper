import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

/**
 * Extract the authenticated user from headers set by Authentik's embedded outpost.
 *
 * Authentik sets these headers (as configured in the NPM proxy template):
 *   X-authentik-email    — user's email address (used as userId)
 *   X-authentik-username — username
 *   X-authentik-uid      — OIDC sub (UUID)
 *
 * In development (NODE_ENV !== 'production'), falls back to the DEV_USER_ID env var.
 * Returns 401 if no user can be determined in production.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user =
    (req.headers['x-authentik-email'] as string | undefined) ??
    (process.env.NODE_ENV !== 'production' ? process.env.DEV_USER_ID : undefined);

  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  req.userId = user;
  next();
}
