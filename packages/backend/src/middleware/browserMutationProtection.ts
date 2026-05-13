import type { Request, Response, NextFunction } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function extractHost(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

export function isSameOriginBrowserRequest(req: Request): boolean {
  const requestHost = req.headers.host?.toLowerCase();
  if (!requestHost) {
    return false;
  }

  const originHost = extractHost(req.headers.origin as string | undefined);
  if (originHost) {
    return originHost === requestHost;
  }

  const refererHost = extractHost(req.headers.referer);
  if (refererHost) {
    return refererHost === requestHost;
  }

  return false;
}

export function protectBrowserMutations(req: Request, res: Response, next: NextFunction): void {
  if (req.authMethod !== 'header' || SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  if (isSameOriginBrowserRequest(req)) {
    next();
    return;
  }

  res.status(403).json({ error: 'Cross-site browser request blocked' });
}
