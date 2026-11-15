import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  type AuthMode,
  type AuthStatus,
  type AuthUser,
  type LoginResponse,
} from '@/lib/api';

/**
 * Real session state for the app shell (Phase B, §6).
 *
 * Before this phase the context only carried a `sessionExpired` flag. It now
 * carries the signed-in user, role, MFA status, the active auth mode and the
 * operations the AuthGate/Login surface needs. `refresh()` is the single
 * re-read used after login and after any future privilege change.
 */

export interface AuthContextValue {
  user: AuthUser | null;
  role: 'user' | 'admin' | null;
  mfaEnabled: boolean;
  /**
   * A local-mode administrator who has not enrolled TOTP. The backend answers
   * their admin calls with `mfa_enrolment_required`, so the shell prompts them
   * to enrol instead of letting them walk into 404s.
   */
  mfaEnrolmentRequired: boolean;
  mode: AuthMode | null;
  loading: boolean;
  sessionExpired: boolean;
  markSessionExpired: () => void;
  refresh: () => Promise<AuthStatus>;
  /** Replace the cached user after a profile or password change. */
  applyUser: (user: AuthUser) => void;
  login: (identifier: string, password: string) => Promise<LoginResponse>;
  /** Second step: TOTP code or recovery code, with the same credential pair. */
  loginMfa: (identifier: string, password: string, code: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  role: null,
  mfaEnabled: false,
  mfaEnrolmentRequired: false,
  mode: null,
  loading: false,
  sessionExpired: false,
  markSessionExpired: () => {},
  refresh: async () => ({ authenticated: false, mode: 'local' }),
  applyUser: () => {},
  login: async () => ({ status: 'mfa_required' }),
  loginMfa: async () => ({ status: 'mfa_required' }),
  logout: async () => {},
  logoutAll: async () => {},
});

export function useAuthContext() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const applyStatus = useCallback((status: AuthStatus) => {
    setMode(status.mode);
    setUser(status.authenticated ? status.user ?? null : null);
    if (status.authenticated) {
      setSessionExpired(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const status = await api.auth.status();
    applyStatus(status);
    return status;
  }, [applyStatus]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const status = await api.auth.status();
        if (!cancelled) {
          applyStatus(status);
        }
      } catch {
        // Backend unreachable: leave the user null so AuthGate shows the
        // sign-in surface instead of an empty, broken app.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyStatus]);

  const login = useCallback(
    async (identifier: string, password: string): Promise<LoginResponse> => {
      const result = await api.auth.login(identifier, password);

      if (result.status === 'ok') {
        setUser(result.user);
        setSessionExpired(false);
        try {
          // Authoritative re-read: also resolves the active mode in hybrid.
          await refresh();
        } catch {
          // The login response itself is enough to enter the app.
        }
      }

      return result;
    },
    [refresh]
  );

  const loginMfa = useCallback(
    async (identifier: string, password: string, code: string): Promise<LoginResponse> => {
      const result = await api.auth.loginMfa(identifier, password, code);

      if (result.status === 'ok') {
        setUser(result.user);
        setSessionExpired(false);
        try {
          await refresh();
        } catch {
          // The completion response itself is enough to enter the app.
        }
      }

      return result;
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
      setSessionExpired(false);
    }
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await api.auth.logoutAll();
    } finally {
      setUser(null);
      setSessionExpired(false);
    }
  }, []);

  const markSessionExpired = useCallback(() => setSessionExpired(true), []);

  const applyUser = useCallback((next: AuthUser) => {
    setUser(next);
    setSessionExpired(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role ?? null,
        mfaEnabled: user?.mfaEnabled ?? false,
        mfaEnrolmentRequired: Boolean(
          user && user.role === 'admin' && !user.mfaEnabled && mode !== 'proxy'
        ),
        mode,
        loading,
        sessionExpired,
        markSessionExpired,
        refresh,
        applyUser,
        login,
        loginMfa,
        logout,
        logoutAll,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
