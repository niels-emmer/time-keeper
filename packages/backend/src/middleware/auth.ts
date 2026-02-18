import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

/**
 * Extract the authenticated user from the X-Auth-Request-User header set by oauth2-proxy.
 * In development, falls back to the DEV_USER_ID environment variable.
 * Returns 401 if no user can be determined.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user =
    req.headers['x-auth-request-user'] as string | undefined ??
    (process.env.NODE_ENV !== 'production' ? process.env.DEV_USER_ID : undefined);

  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  req.userId = user;
  next();
}
