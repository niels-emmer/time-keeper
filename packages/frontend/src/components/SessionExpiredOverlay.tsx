import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Full-screen overlay shown when any API call returns 401/403.
 * Tapping "Log in again" navigates to the app root, which Authentik's
 * NPM forward-auth will intercept and redirect to the login page.
 */
export function SessionExpiredOverlay() {
  function handleLogin() {
    // A hard navigation to '/' lets NPM + Authentik redirect to the login page.
    // location.reload() would just re-fetch the same expired state.
    window.location.href = '/';
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background/95 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 text-center px-8">
        <LogIn className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold tracking-tight">Session expired</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Your Authentik session has ended. Log in again to continue tracking time.
        </p>
      </div>
      <Button onClick={handleLogin} className="gap-2">
        <LogIn className="h-4 w-4" />
        Log in again
      </Button>
    </div>
  );
}
