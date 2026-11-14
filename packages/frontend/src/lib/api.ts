import type {
  Category,
  CreateCategoryDTO,
  UpdateCategoryDTO,
  CreateEntryDTO,
  UpdateEntryDTO,
  TimeEntry,
  WeeklySummary,
  MonthlySummary,
  RoundingResult,
} from '@time-keeper/shared';

const BASE = '/api';

/**
 * Thrown when the server returns 401 — the session is gone, and the AuthGate
 * must show the sign-in surface. Keep this distinct from `ForbiddenError`:
 * a 403 is a permission/CSRF answer, not an expiry.
 */
export class AuthError extends Error {
  constructor(status = 401) {
    super(`Session expired (HTTP ${status})`);
    this.name = 'AuthError';
  }
}

/** Thrown when the server returns 403: authenticated, but not allowed. */
export class ForbiddenError extends Error {
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export type AuthMode = 'local' | 'proxy' | 'hybrid';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: 'user' | 'admin';
  mfaEnabled: boolean;
  mustSetPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthStatus {
  authenticated: boolean;
  mode: AuthMode;
  user?: AuthUser;
}

export type LoginResponse =
  | { status: 'ok'; user: AuthUser; csrfToken: string }
  | { status: 'mfa_required' };

export interface SettingsPayload {
  weeklyGoalHours: number;
  roundingIncrementMinutes: 30 | 60;
  /** IANA zone used for local-day bucketing (DEC-2); defaults to UTC. */
  timezone: string;
}

/**
 * Read the non-httpOnly `tk_csrf` cookie. The double-submit pattern is
 * cookie + header, so the browser-visible half is the source of truth after a
 * reload as well as immediately after login.
 */
function readCsrfToken(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === 'tk_csrf') {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return undefined;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Human-readable text for any query or mutation failure. Surfaces the server's
 * `error` message when there is one, and never leaves the caller to render a
 * blank panel (finding M-3).
 */
export function getErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (error instanceof AuthError) {
    return 'Your session has expired. Reload the page to sign in again.';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const csrfToken = SAFE_METHODS.has(method) ? undefined : readCsrfToken();

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...init?.headers,
      },
      ...init,
      // Session cookies are same-origin; send them explicitly so a deployment
      // that ever moves the API to a sibling origin does not silently drop them.
      credentials: 'same-origin',
      // Manual redirect mode so we can detect when Authentik's forward-auth
      // proxy issues a 302 → login redirect instead of passing the request
      // through.  With the default 'follow' the browser chases the redirect
      // chain to the Authentik login page (cross-origin), which either throws
      // a CORS TypeError or returns 200 HTML — neither surfaces as an AuthError.
      redirect: 'manual',
    });
  } catch {
    // fetch only rejects for network-level failures (offline, DNS, CORS).
    // Normalise the browser-specific "Failed to fetch" into UI-ready copy.
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  if (res.type === 'opaqueredirect') {
    // NPM's error_page 401 returned a redirect to the Authentik login page.
    throw new AuthError(302);
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new AuthError(res.status);
    }
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      throw new ForbiddenError((body as { error?: string }).error);
    }
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Categories
export const api = {
  auth: {
    status: () => request<AuthStatus>('/auth/status'),
    login: (identifier: string, password: string) =>
      request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    logoutAll: () => request<void>('/auth/logout-all', { method: 'POST' }),
    me: () => request<{ user: AuthUser }>('/auth/me'),
  },

  categories: {
    list: () => request<Category[]>('/categories'),
    create: (dto: CreateCategoryDTO) =>
      request<Category>('/categories', { method: 'POST', body: JSON.stringify(dto) }),
    update: (id: number, dto: UpdateCategoryDTO) =>
      request<Category>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(dto) }),
    delete: (id: number) =>
      request<void>(`/categories/${id}`, { method: 'DELETE' }),
    reorder: (items: { id: number; sortOrder: number }[]) =>
      request<void>('/categories/reorder', { method: 'PATCH', body: JSON.stringify(items) }),
  },

  timer: {
    status: () => request<{ active: false } | { active: true; entry: TimeEntry }>('/timer'),
    start: (categoryId: number) =>
      request<TimeEntry>('/timer/start', { method: 'POST', body: JSON.stringify({ categoryId }) }),
    stop: () => request<TimeEntry>('/timer/stop', { method: 'POST', body: JSON.stringify({}) }),
  },

  entries: {
    listByDate: (date: string) => request<TimeEntry[]>(`/entries?date=${date}`),
    listByWeek: (week: string) => request<TimeEntry[]>(`/entries?week=${week}`),
    create: (dto: CreateEntryDTO) =>
      request<TimeEntry>('/entries', { method: 'POST', body: JSON.stringify(dto) }),
    update: (id: number, dto: UpdateEntryDTO) =>
      request<TimeEntry>(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
    delete: (id: number) =>
      request<void>(`/entries/${id}`, { method: 'DELETE' }),
  },

  summary: {
    weekly: (week?: string) =>
      request<WeeklySummary>(`/summary/weekly${week ? `?week=${week}` : ''}`),
    monthly: (month: string) =>
      request<MonthlySummary>(`/summary/monthly?month=${encodeURIComponent(month)}`),
    round: (date: string) =>
      request<RoundingResult>('/summary/round', { method: 'POST', body: JSON.stringify({ date }) }),
    roundWeek: (week: string) =>
      request<{ week: string; results: RoundingResult[] }>('/summary/round-week', { method: 'POST', body: JSON.stringify({ week }) }),
    adjustCell: (dto: { date: string; categoryId: number; minutes: number }) =>
      request<{ ok: boolean }>('/summary/adjust-cell', { method: 'PATCH', body: JSON.stringify(dto) }),
  },

  info: {
    get: () => request<{ version: string; repoUrl: string; user: string }>('/info'),
  },

  settings: {
    get: () => request<SettingsPayload>('/settings'),
    update: (settings: SettingsPayload) =>
      request<SettingsPayload>('/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
  },

  tokens: {
    list: () =>
      request<{ id: number; label: string; createdAt: string; lastUsedAt: string | null; expiresAt: string }[]>('/tokens'),
    create: (label: string) =>
      request<{ id: number; label: string; createdAt: string; expiresAt: string; token: string }>('/tokens', {
        method: 'POST',
        body: JSON.stringify({ label }),
      }),
    revoke: (id: number) => request<void>(`/tokens/${id}`, { method: 'DELETE' }),
  },
} as const;
