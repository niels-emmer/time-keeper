import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AuthError, getErrorMessage } from '@/lib/api';
import { useAuthContext } from '@/lib/authContext';

/**
 * Local sign-in (Phase B, §6).
 *
 * One step: username **or** email plus password. The MFA second step belongs to
 * Phase D; when the backend answers `mfa_required` this page says so honestly
 * instead of pretending a session exists.
 *
 * Visual language follows the existing macOS-native shadcn surface: the same
 * card, input, button and destructive-alert treatments used elsewhere.
 */
export function Login() {
  const { login } = useAuthContext();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identifier.trim() || !password || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setMfaRequired(false);

    try {
      const result = await login(identifier.trim(), password);
      if (result.status === 'mfa_required') {
        setMfaRequired(true);
        setPassword('');
      }
    } catch (caught) {
      if (caught instanceof AuthError) {
        // The login route uses 401 for every credential failure (unknown user,
        // wrong password, disabled account), so this copy leaks nothing.
        setError('Invalid username or password.');
      } else {
        setError(getErrorMessage(caught, 'Could not sign in. Please try again.'));
      }
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img
            src="/icons/timekeeper.svg"
            alt=""
            className="h-12 w-12"
            aria-hidden="true"
          />
          <h1 className="text-xl font-bold tracking-tight">Time Keeper</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to continue tracking time.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <h2 className="text-base font-semibold tracking-tight">Sign in</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="identifier" className="text-sm font-medium">
                  Username or email
                </label>
                <Input
                  id="identifier"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              {mfaRequired && (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
                >
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    Two-factor authentication is required for this account. The
                    verification step is not available in this release yet.
                  </span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full gap-2"
                disabled={submitting || !identifier.trim() || !password}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                )}
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
