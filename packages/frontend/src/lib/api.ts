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
  /**
   * The server's machine-readable reason, when it sent one. A 401 is normally a
   * missing/expired session, but `/auth/login/mfa` also answers 401 for a code
   * failure (the password was already proven). Carrying the code keeps the
   * "which one was it" decision with the caller instead of string-matching.
   */
  readonly code?: string;

  constructor(status = 401, code?: string) {
    super(`Session expired (HTTP ${status})`);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** Thrown when the server returns 403: authenticated, but not allowed. */
export class ForbiddenError extends Error {
  /**
   * The server's machine-readable reason, when it sent one. `reauthentication_
   * required` is the Q17 freshness gate; the Account screen turns it into a
   * "sign in again" prompt rather than a generic permission error.
   */
  readonly code?: string;

  constructor(message = 'You do not have permission to do that.', code?: string) {
    super(message);
    this.name = 'ForbiddenError';
    this.code = code;
  }
}

/**
 * Any other non-2xx answer. Carries the status and the server's `code` so a
 * form can tell a 409 (email already taken) from a 400 (policy message)
 * without string-matching the copy.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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

/** One signed-in device, as the account screen lists it (D4). */
export interface SessionSummary {
  /** The stored SHA-256 of the session id — a handle, not the cookie value. */
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

export interface AcceptInvitePayload {
  token: string;
  email: string;
  username: string;
  password: string;
}

export interface ProfilePayload {
  displayName?: string | null;
  email?: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface DeleteAccountPayload {
  password: string;
  confirmUsername: string;
}

/**
 * What `POST /api/auth/mfa/enrol` returns. The secret and URI are shown exactly
 * once; nothing is active until `confirmMfa` succeeds.
 */
export interface MfaEnrolment {
  secret: string;
  otpauthUri: string;
  algorithm: 'SHA1';
  digits: 6;
  period: 30;
}

/**
 * An account as the admin surface renders it (Phase E). Credential material
 * (`password_hash`, `mfa_secret_enc`, recovery codes) is never part of this.
 */
export interface AdminUserRecord {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: 'user' | 'admin';
  disabled: boolean;
  mfaEnabled: boolean;
  mustSetPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** A row of `GET /api/admin/users`: the account plus its entry count. */
export interface AdminUser extends AdminUserRecord {
  entryCount: number;
}

/** One row of the admin audit viewer (Q12). */
export interface AdminAuthEvent {
  id: number;
  kind: string;
  actor: { id: string; email: string; username: string } | null;
  ip: string | null;
  userAgent: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminAuthEventPage {
  events: AdminAuthEvent[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

/** The admin-issued reset code, returned once and never retrievable again. */
export interface AdminResetCode {
  resetCode: string;
  expiresAt: string;
}

export type AdminDeleteMode = 'cascade' | 'reassign';

export interface AdminDeleteResult {
  deleted: true;
  mode: AdminDeleteMode;
  entriesReassigned: number;
  categoriesMoved: number;
  categoriesMerged: number;
}

export interface SettingsPayload {  weeklyGoalHours: number;
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
 * Copy that is better than the server's own line, keyed by the stable `code`
 * the API sends. Everything not listed here keeps the server's message: a route
 * that knows something specific (a password-policy violation, a taken email)
 * says it better than a generic table can.
 *
 * The MFA entries are the readable, *safe* reasons a code can fail. Wrong and
 * expired deliberately share one line: telling them apart would reveal whether
 * a guess was close, which is exactly what must not leak. "Already used" is the
 * one reason that is safe to name, because it is about our own replay record
 * rather than about the guess.
 */
const CODE_MESSAGES: Record<string, string> = {
  mfa_code_invalid:
    'That code is not valid. Authenticator codes change every 30 seconds, so wait for the current one and try again.',
  mfa_code_replayed:
    'That code has already been used. Wait for your authenticator to show the next code, then try again.',
  mfa_enrolment_not_started:
    'Setup needs restarting: start two-factor setup again to get a fresh key, then confirm it.',
  mfa_already_enabled: 'Two-factor authentication is already on for this account.',
  mfa_not_enabled: 'Two-factor authentication is not on for this account.',
  reauthentication_required:
    'For your security this needs a fresh sign-in. Sign in again, then retry.',
  interactive_authentication_required:
    'This action needs a browser sign-in. It cannot be done with an API token.',
  last_admin: 'This is the last administrator, so it cannot be removed or demoted.',
};

const GENERIC_FALLBACK = 'Something went wrong. Please try again.';

/**
 * Readable copy for the failures that arrive without a JSON body at all.
 * `express-rate-limit` answers a plain-text 429, and a proxy in front of the app
 * can answer 502/503 with HTML; both used to surface as "HTTP 429"/"HTTP 502",
 * which is technically non-empty but tells the person nothing.
 */
const STATUS_MESSAGES: Record<number, string> = {
  400: 'That request was not valid. Check the form and try again.',
  403: 'You do not have permission to do that.',
  404: 'That item no longer exists.',
  409: 'That conflicts with something that already exists.',
  413: 'That request was too large.',
  429: 'Too many requests. That limit is temporary — wait a minute and try again.',
  500: 'Something went wrong on the server. Try again.',
  502: 'The server is not reachable right now. Try again in a moment.',
  503: 'The server is not reachable right now. Try again in a moment.',
  504: 'The server took too long to answer. Try again in a moment.',
};

function statusMessage(status: number): string {
  return STATUS_MESSAGES[status] ?? `HTTP ${status}`;
}

/**
 * A server-provided message is only usable when it is a non-blank string. An
 * error body of `{}`, `{ issues: [...] }`, `{ error: null }` or `{ error: {} }`
 * must never render as an empty alert (finding: empty MFA error banner).
 */
export function normalizeServerMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function mappedCodeMessage(code: string | undefined): string | undefined {
  return code ? CODE_MESSAGES[code] : undefined;
}

/**
 * Human-readable text for any query or mutation failure.
 *
 * Guarantees non-empty copy: the server's message when it is usable, a
 * code-specific line when we have a better one, and a generic fallback when
 * neither exists. Never leaves the caller to render a blank panel (finding M-3,
 * and the empty MFA error banner).
 */
export function getErrorMessage(error: unknown, fallback = GENERIC_FALLBACK): string {
  const safeFallback = normalizeServerMessage(fallback) ?? GENERIC_FALLBACK;

  if (error instanceof AuthError) {
    return mappedCodeMessage(error.code) ?? 'Your session has expired. Reload the page to sign in again.';
  }
  if (error instanceof ForbiddenError || error instanceof ApiError) {
    return (
      mappedCodeMessage(error.code) ?? normalizeServerMessage(error.message) ?? safeFallback
    );
  }
  if (error instanceof Error) {
    return normalizeServerMessage(error.message) ?? safeFallback;
  }
  return safeFallback;
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
      // A 401 is usually an expired session, but `/auth/login/mfa` also answers
      // 401 for a rejected code. Read the body best-effort so the caller can
      // tell the two apart; a non-JSON body simply yields no code.
      const body = await res.json().catch(() => ({}));
      const parsed = body as { code?: string };
      throw new AuthError(res.status, normalizeServerMessage(parsed.code));
    }
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      const parsed = body as { error?: unknown; code?: string };
      throw new ForbiddenError(
        normalizeServerMessage(parsed.error) ?? 'You do not have permission to do that.',
        normalizeServerMessage(parsed.code)
      );
    }
    const body = await res.json().catch(() => ({}));
    const parsed = body as { error?: unknown; code?: string };
    throw new ApiError(
      normalizeServerMessage(parsed.error) ?? statusMessage(res.status),
      res.status,
      normalizeServerMessage(parsed.code)
    );
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

    /**
     * Complete the MFA challenge (Phase D). The password is re-sent because the
     * server issued no half-authenticated token at the first step.
     */
    loginMfa: (identifier: string, password: string, code: string) =>
      request<LoginResponse>('/auth/login/mfa', {
        method: 'POST',
        body: JSON.stringify({ identifier, password, code }),
      }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    logoutAll: () => request<void>('/auth/logout-all', { method: 'POST' }),
    me: () => request<{ user: AuthUser }>('/auth/me'),

    /** Registration by invitation (Phase C). Public — no session exists yet. */
    acceptInvite: (payload: AcceptInvitePayload) =>
      request<{ status: 'ok'; user: AuthUser; csrfToken: string }>('/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    /**
     * Redeem an admin-issued reset code and set a new password (D5, Phase F).
     * Public — the holder has no session yet. Works for a forgotten password
     * and for the `must_set_password` bootstrap of a newly created or migrated
     * account. Success is 204 and does not sign the caller in.
     */
    resetPassword: (payload: { code: string; newPassword: string }) =>
      request<void>('/auth/reset', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    /** Display name and email only; the username is immutable server-side. */
    updateProfile: (payload: ProfilePayload) =>
      request<{ user: AuthUser }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),

    changePassword: (payload: ChangePasswordPayload) =>
      request<{ user: AuthUser; otherSessionsRevoked: number }>('/auth/password', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    deleteAccount: (payload: DeleteAccountPayload) =>
      request<void>('/auth/me', {
        method: 'DELETE',
        body: JSON.stringify(payload),
      }),

    sessions: () =>
      request<{ currentSessionId: string | null; sessions: SessionSummary[] }>(
        '/auth/sessions'
      ),

    revokeSession: (id: string) =>
      request<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    revokeOtherSessions: () =>
      request<{ revoked: number }>('/auth/sessions/others', { method: 'DELETE' }),

    /**
     * MFA (Phase D). `enrol` returns a pending secret and changes nothing;
     * `confirm` is the only call that can activate it, and it returns the ten
     * recovery codes exactly once.
     */
    enrolMfa: () => request<MfaEnrolment>('/auth/mfa/enrol', { method: 'POST' }),

    confirmMfa: (code: string) =>
      request<{ recoveryCodes: string[] }>('/auth/mfa/confirm', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),

    disableMfa: (password: string) =>
      request<void>('/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),

    regenerateRecoveryCodes: (password: string) =>
      request<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes/regenerate', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
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

  /**
   * Administrator surface (Phase E). Every call is 404 for a non-admin and 403
   * with `mfa_enrolment_required` for a local administrator without MFA; the
   * Settings entry point is hidden entirely from non-admins.
   */
  admin: {
    users: () => request<{ users: AdminUser[] }>('/admin/users'),

    /** Creates the account and returns its 60-minute reset code exactly once. */
    createUser: (payload: { email: string; username: string; role: 'user' | 'admin' }) =>
      request<{ user: AdminUserRecord; resetCode: string; resetExpiresAt: string }>('/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    updateUser: (id: string, payload: { role?: 'user' | 'admin'; disabled?: boolean }) =>
      request<{ user: AdminUserRecord }>(`/admin/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),

    /** Q16: the caller must choose cascade or reassign explicitly. */
    deleteUser: (id: string, mode: AdminDeleteMode) =>
      request<AdminDeleteResult>(`/admin/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ mode }),
      }),

    /** Issues a new code and invalidates the account's previous one. */
    resetUser: (id: string) =>
      request<AdminResetCode>(`/admin/users/${encodeURIComponent(id)}/reset`, {
        method: 'POST',
      }),

    authEvents: (page = 1, limit = 50) =>
      request<AdminAuthEventPage>(`/admin/auth-events?page=${page}&limit=${limit}`),
  },
} as const;
