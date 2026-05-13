export const API_TOKEN_TTL_DAYS = 365;

const API_TOKEN_TTL_MS = API_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export function createTokenExpiryTimestamp(from = new Date()): string {
  return new Date(from.getTime() + API_TOKEN_TTL_MS).toISOString();
}

export function isTokenExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiryTime = Date.parse(expiresAt);
  if (Number.isNaN(expiryTime)) {
    return true;
  }

  return expiryTime <= now.getTime();
}
