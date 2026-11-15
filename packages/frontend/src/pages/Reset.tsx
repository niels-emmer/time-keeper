import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Circle, KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { InlineError } from '@/components/QueryState';
import { ApiError, api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Password reset / first-password page (D5, Phase F).
 *
 * Public on purpose: the holder of an admin-issued code has no session yet, so
 * this sits outside `AuthGate` alongside `Register`. There is no SMTP in v1 —
 * an administrator issues a single-use 60-minute code and hands it over out of
 * band, and this page is where it is redeemed.
 *
 * The same page covers the `must_set_password` bootstrap case: a newly created
 * account, a migrated account, and the first administrator created on a fresh
 * database all start with an unusable password and a reset code. Redeeming the
 * code writes the password and clears the flag, so no separate first-login flow
 * is needed.
 *
 * The code arrives either in the URL (`/reset?code=…`, what an admin hands over)
 * or typed into the field (what someone who was given a bare code does). The
 * password policy is the same one the API enforces (Q22); the length and
 * confirmation checks are shown live, and the server's exact message is surfaced
 * for the rules this page cannot evaluate without knowing the account.
 */

const MIN_PASSWORD_LENGTH = 12;

export function Reset() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const codeFromUrl = (searchParams.get('code') ?? '').trim();
  const [code, setCode] = useState(codeFromUrl);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const passwordChecks = useMemo(
    () => [
      {
        label: `At least ${MIN_PASSWORD_LENGTH} characters`,
        met: password.length >= MIN_PASSWORD_LENGTH,
      },
      {
        label: 'Both passwords match',
        met: password.length > 0 && password === confirmPassword,
      },
    ],
    [password, confirmPassword]
  );

  const canSubmit =
    code.trim().length > 0 && passwordChecks.every((check) => check.met) && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await api.auth.resetPassword({ code: code.trim(), newPassword: password });
      setDone(true);
      setPassword('');
      setConfirmPassword('');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'password_policy') {
        setError(caught.message);
      } else {
        setError(
          getErrorMessage(
            caught,
            'We could not set your password. Ask an administrator for a new reset code.'
          )
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Shell subtitle="Your account is ready.">
        <Card>
          <CardHeader className="pb-2">
            <h2 className="text-base font-semibold tracking-tight">Password set</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
            >
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span>Your new password works now. Sign in to continue.</span>
            </div>
            <Button className="w-full gap-2" onClick={() => navigate('/', { replace: true })}>
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              Go to sign in
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell subtitle="Set a new password for your account.">
      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-base font-semibold tracking-tight">Set a new password</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <label htmlFor="reset-code" className="text-sm font-medium">
                Reset code
              </label>
              <Input
                id="reset-code"
                name="code"
                autoComplete="one-time-code"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={!codeFromUrl}
                className="font-mono text-xs"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={submitting}
                required
              />
              <p className="text-xs text-muted-foreground">
                The 60-minute single-use code an administrator gave you. It is not your
                password.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="new-password" className="text-sm font-medium">
                New password
              </label>
              <Input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium">
                Confirm new password
              </label>
              <Input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <ul className="space-y-1" aria-label="Password requirements">
              {passwordChecks.map((check) => (
                <li
                  key={check.label}
                  className={cn(
                    'flex items-center gap-2 text-xs',
                    check.met
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'
                  )}
                >
                  {check.met ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>{check.label}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              The server also rejects a password that contains your username or email
              address, or that appears on its local common-password list.
            </p>

            {error && <InlineError message={error} />}

            <Button type="submit" className="w-full gap-2" disabled={!canSubmit}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              )}
              {submitting ? 'Setting password…' : 'Set password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children, subtitle }: { children: ReactNode; subtitle: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/icons/timekeeper.svg" alt="" className="h-12 w-12" aria-hidden="true" />
          <h1 className="text-xl font-bold tracking-tight">Time Keeper</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
