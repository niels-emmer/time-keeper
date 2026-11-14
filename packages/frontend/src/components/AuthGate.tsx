import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { SessionExpiredOverlay } from '@/components/SessionExpiredOverlay';
import { useAuthContext } from '@/lib/authContext';
import { Login } from '@/pages/Login';

/**
 * Session gate around the app routes (Phase B, §6).
 *
 * 401 handling used to be a global overlay; that is replaced here: while the
 * session status is loading we show a quiet spinner, an unauthenticated browser
 * gets the local login page **in place of the route**, and a resolved session
 * renders the app. Keeping the router mounted means the intended route is still
 * in the URL after sign-in — no redirect bookkeeping.
 *
 * In `proxy` mode there is no local login form to show: the pre-Phase-B
 * `SessionExpiredOverlay` is reused, whose hard reload lets NPM/Authentik
 * intercept and redirect. That preserves today's behaviour exactly.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, user, mode, sessionExpired } = useAuthContext();

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span className="text-sm">Checking your session…</span>
      </div>
    );
  }

  if (user && !sessionExpired) {
    return <>{children}</>;
  }

  // Proxy mode has no local form: reuse the reload overlay so NPM/Authentik
  // intercepts the request. An unknown mode means the status call itself
  // failed, which is also safer to treat as "reload", not "show a local login".
  if (mode === 'proxy' || mode === null) {
    return <SessionExpiredOverlay />;
  }

  return <Login />;
}
