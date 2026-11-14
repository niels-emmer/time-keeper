import type { Request } from 'express';

/**
 * Minimal cookie reading, shared by the session cookie and the CSRF
 * double-submit cookie.
 *
 * Parsed by hand rather than with `cookie-parser`: this is one name/value pair
 * out of a header we already control, and it avoids adding a dependency for it.
 */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() !== name) {
      continue;
    }

    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }

  return undefined;
}
