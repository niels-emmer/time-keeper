import { useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, KeyRound, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AuthError, getErrorMessage } from '@/lib/api';
import { useAuthContext } from '@/lib/authContext';

/**
 * Local sign-in (Phase B + Phase D, §6).
 *
 * Two steps, one card. Step one is username **or** email plus password; a
 * correct password for an MFA-enabled account answers `mfa_required` and no
 * session, which moves the card to step two: a 6-digit authenticator code, or a
 * recovery code via the escape hatch underneath.
 *
 * The password is kept in memory between the two steps because the completion
 * endpoint re-verifies it — Phase B deliberately issued no half-authenticated
 * token, so there is nothing else that could stand in for it.
 *
 * Visual language follows the existing macOS-native shadcn surface: the same
 * card, input, button and destructive-alert treatments used elsewhere. Error
 * copy stays generic on step one (it is the credential step) and specific on
 * step two (the password was already proven, so "that code is not valid" tells
 * the person nothing they do not know).
 */
export function Login() {
  const { login, loginMfa } = useAuthContext();

  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCredentialSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identifier.trim() || !password || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await login(identifier.trim(), password);
      if (result.status === 'mfa_required') {
        setStep('mfa');
        setCode('');
        setUseRecoveryCode(false);
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

  async function handleMfaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = code.trim();
    if (!submitted || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await loginMfa(identifier.trim(), password, submitted);
      // On success the AuthGate swaps this page for the app; nothing to do.
    } catch (caught) {
      if (caught instanceof AuthError) {
        setError(
          useRecoveryCode
            ? 'That recovery code is not valid, or it has already been used.'
            : 'That code is not valid. Check your authenticator and try again.'
        );
      } else {
        setError(getErrorMessage(caught, 'Could not verify that code. Please try again.'));
      }
      setCode('');
    } finally {
      setSubmitting(false);
    }
  }

  function backToCredentials() {
    setStep('credentials');
    setCode('');
    setError(null);
    setUseRecoveryCode(false);
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
            <h2 className="text-base font-semibold tracking-tight">
              {step === 'credentials' ? 'Sign in' : 'Two-factor authentication'}
            </h2>
          </CardHeader>
          <CardContent>
            {step === 'credentials' ? (
              <form onSubmit={handleCredentialSubmit} className="space-y-4">
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
            ) : (
              <form onSubmit={handleMfaSubmit} className="space-y-4">
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
                >
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    Two-factor authentication is required for this account.
                    {useRecoveryCode
                      ? ' Enter one of the recovery codes you saved when you set it up.'
                      : ' Enter the 6-digit code from your authenticator app.'}
                  </span>
                </div>

                <div className="space-y-2">
                  <label htmlFor="mfa-code" className="text-sm font-medium">
                    {useRecoveryCode ? 'Recovery code' : 'Authentication code'}
                  </label>
                  <Input
                    id="mfa-code"
                    name="code"
                    autoComplete={useRecoveryCode ? 'off' : 'one-time-code'}
                    inputMode={useRecoveryCode ? 'text' : 'numeric'}
                    autoCapitalize={useRecoveryCode ? 'characters' : 'none'}
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    placeholder={useRecoveryCode ? 'XXXXX-XXXXX' : '123456'}
                    maxLength={useRecoveryCode ? 13 : 6}
                    className={useRecoveryCode ? 'font-mono' : 'font-mono tracking-[0.4em]'}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
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

                <Button
                  type="submit"
                  className="w-full gap-2"
                  disabled={submitting || code.trim().length === 0}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                  )}
                  {submitting ? 'Verifying…' : 'Verify and sign in'}
                </Button>

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    onClick={backToCredentials}
                    disabled={submitting}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    Back
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => {
                      setUseRecoveryCode((current) => !current);
                      setCode('');
                      setError(null);
                    }}
                    disabled={submitting}
                  >
                    {useRecoveryCode ? 'Use an authenticator code' : 'Use a recovery code'}
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
