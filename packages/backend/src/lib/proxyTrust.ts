import { BlockList, isIP } from 'net';
import type { Request } from 'express';

/**
 * Proxy-trust primitives, extracted from `middleware/auth.ts` so that the
 * session cookie can decide `Secure` from `X-Forwarded-Proto` using the same
 * peer check the identity headers use, without a middleware <-> session import
 * cycle. `middleware/auth.ts` re-exports these for existing importers.
 */

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

  const configured =
    extra
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

/** First value of a possibly-repeated request header, lower-cased and trimmed. */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',')[0]?.trim().toLowerCase() || undefined;
}

/**
 * True when the request is known to have arrived over TLS.
 *
 * In production the answer is unconditional: the deployment terminates TLS at
 * NPM, and a session cookie must never travel unencrypted, so a missing or
 * spoofed `X-Forwarded-Proto` must not be able to downgrade it.
 *
 * Outside production the header is only believed when the TCP peer is a proxy
 * we control — the same rule the identity headers use. A client that can reach
 * the backend directly cannot turn `Secure` off (or on) by setting the header
 * itself.
 */
export function isSecureRequest(req: Request): boolean {
  if (process.env.NODE_ENV === 'production') {
    return true;
  }

  if (!isTrustedProxyPeer(req)) {
    return false;
  }

  return firstHeaderValue(req.headers['x-forwarded-proto']) === 'https';
}
