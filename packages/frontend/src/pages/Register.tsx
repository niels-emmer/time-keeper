import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Circle, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { api, getErrorMessage } from '@/lib/api';
import { useAuthContext } from '@/lib/authContext';
import { cn } from '@/lib/utils';

/**
 * Invite acceptance (Phase C, §6).
 *
 * Registration is invite-only (D2): the token in the query string is the only
 * credential, so there is no self-service signup path to render. The page shows
 * the password policy inline — the same four things the API checks — because
 * discovering a policy by rejection is a bad first impression.
 *
 * A bad token produces the backend's single generic message; unknown, used and
 * expired links are deliberately indistinguishable.
 */

const MIN_PASSWORD_LENGTH = 12;

interface PolicyCheck {
  label: string;
  met: boolean;
}

export function Register() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') ?? '').trim();
  const navigate = useNavigate();
  const { refresh } = useAuthContext();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const policyChecks = useMemo<PolicyCheck[]>(() => {
    const loweredPassword = password.toLowerCase();
    const normalisedUsername = username.trim().toLowerCase();
    const normalisedEmail = email.trim().toLowerCase();
    const emailLocalPart = normalisedEmail.includes('@')
      ? normalisedEmail.slice(0, normalisedEmail.indexOf('@'))
      : normalisedEmail;

    return [
      {
        label: `At least ${MIN_PASSWORD_LENGTH} characters`,
        met: password.length >= MIN_PASSWORD_LENGTH,
      },
      {
        label: 'Does not contain your username',
        met:
          normalisedUsername.length < 3 || !loweredPassword.includes(normalisedUsername),
      },
      {
        label: 'Does not contain your email address',
        met: emailLocalPart.length < 3 || !loweredPassword.includes(emailLocalPart),
      },
    ];
  }, [password, username, email]);

  const passwordMeetsPolicy = policyChecks.every((check) => check.met);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !token || !passwordMeetsPolicy) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await api.auth.acceptInvite({
        token,
        email: email.trim(),
        username: username.trim().toLowerCase(),
        password,
      });
      // The response set the session cookie. Re-read the authoritative status,
      // but never report a failed registration when only that re-read failed:
      // the account exists either way.
      try {
        await refresh();
      } catch {
        // A reload resolves the session from the cookie.
      }
      navigate('/', { replace: true });
    } catch (caught) {
      setError(
        getErrorMessage(
          caught,
          'We could not complete your registration. Ask an administrator for a new invitation.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <Shell>
        <Card>
          <CardHeader className="pb-2">
            <h2 className="text-base font-semibold tracking-tight">Invitation required</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This page needs a complete invitation link. Accounts on this instance are
              created by invitation only.
            </p>
            <p className="text-sm text-muted-foreground">
              Ask an administrator for a new link and open it directly.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-base font-semibold tracking-tight">Create your account</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                Username
              </label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={submitting}
                required
              />
              <p className="text-xs text-muted-foreground">
                3–32 characters: lowercase letters, numbers, hyphens and underscores. It
                cannot be changed later.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                required
              />
              <ul className="space-y-1 pt-1" aria-label="Password requirements">
                {policyChecks.map((check) => (
                  <li
                    key={check.label}
                    className={cn(
                      'flex items-center gap-2 text-xs',
                      check.met ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
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
              disabled={submitting || !email.trim() || !username.trim() || !passwordMeetsPolicy}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <UserPlus className="h-4 w-4" aria-hidden="true" />
              )}
              {submitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/icons/timekeeper.svg" alt="" className="h-12 w-12" aria-hidden="true" />
          <h1 className="text-xl font-bold tracking-tight">Time Keeper</h1>
          <p className="text-sm text-muted-foreground">You have been invited.</p>
        </div>
        {children}
      </div>
    </div>
  );
}
