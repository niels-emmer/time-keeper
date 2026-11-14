import { createHash } from 'crypto';
import { BlockList, isIP } from 'net';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiTokens } from '../db/schema.js';
import { isTokenExpired } from '../lib/apiTokenExpiry.js';

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

/**
 * Ranges that are never publicly routable. A request whose TCP peer is in one
 * of these ranges is assumed to have arrived from the proxy chain (nginx on
 * the private Docker network, or NPM itself).
 */
const DEFAULT_TRUSTED_PROXY_CIDRS: readonly string[] = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

function addCidr(list: BlockList, cidr: string): void {
  const [address, prefixPart] = cidr.split('/');
  if (!address) {
    return;
  }

  const family = isIP(address);
  if (family === 0) {
    return;
  }

  const maxPrefix = family === 4 ? 32 : 128;
  const prefix = prefixPart === undefined ? maxPrefix : Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    return;
  }

  try {
    list.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  } catch {
    // Ignore malformed entries; the built-in defaults still apply.
  }
}

/**
 * `TRUSTED_PROXY_CIDRS` extends the built-in loopback/private ranges rather
 * than replacing them, so the safe default stays in force when the variable is
 * unset or blank.
 */
function buildTrustedProxyBlockList(extra: string | undefined): BlockList {
  const list = new BlockList();

  for (const cidr of DEFAULT_TRUSTED_PROXY_CIDRS) {
    addCidr(list, cidr);
  }

  const configured = extra
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];

  for (const cidr of configured) {
    addCidr(list, cidr);
  }

  return list;
}

/**
 * True when the TCP peer is loopback, a private range, or inside an explicit
 * `TRUSTED_PROXY_CIDRS` entry.
 *
 * This reads `req.socket.remoteAddress`, never `req.ip`. Express derives
 * `req.ip` from `X-Forwarded-For`, which any client can set; the socket peer
 * address cannot be chosen by the request.
 */
export function isTrustedProxyPeer(req: Request): boolean {
  const remoteAddress = req.socket?.remoteAddress;
  if (!remoteAddress) {
    return false;
  }

  // Normalise IPv4-mapped IPv6 (::ffff:127.0.0.1) and zone-scoped link-local
  // addresses (fe80::1%eth0) to a form `isIP` understands.
  const withoutZone = remoteAddress.split('%')[0];
  const normalized =
    withoutZone.startsWith('::ffff:') && isIP(withoutZone.slice(7)) === 4
      ? withoutZone.slice(7)
      : withoutZone;

  const family = isIP(normalized);
  if (family === 0) {
    return false;
  }

  return buildTrustedProxyBlockList(process.env.TRUSTED_PROXY_CIDRS).check(
    normalized,
    family === 4 ? 'ipv4' : 'ipv6'
  );
}

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
        if (isTokenExpired(row.expiresAt)) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

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
  if (headerUser && isTrustedProxyRequest(req)) {
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
