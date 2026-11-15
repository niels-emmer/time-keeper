import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  KeyRound,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Save,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InlineError, QueryState } from '@/components/QueryState';
import {
  ApiError,
  ForbiddenError,
  api,
  getErrorMessage,
  type AuthUser,
  type SessionSummary,
} from '@/lib/api';
import { useAuthContext } from '@/lib/authContext';

/**
 * Account self-service (Phase C, §6).
 *
 * Four sections, each independent so a failure in one never blanks the others:
 * profile, password, signed-in devices and deletion. Every mutation renders the
 * server's own message — a silently reverted form is treated as a bug.
 *
 * Q17 freshness is surfaced explicitly: a 403 with `reauthentication_required`
 * means the session is older than five minutes and the person must sign in
 * again, which is a different answer from "you are not allowed".
 */

function mutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ForbiddenError) {
    if (error.code === 'reauthentication_required') {
      return 'For your security this needs a fresh sign-in. Sign out and sign back in, then try again.';
    }
    if (error.code === 'interactive_authentication_required') {
      return 'This action needs a browser sign-in. It cannot be done with an API token.';
    }
  }

  if (error instanceof ApiError || error instanceof Error) {
    return getErrorMessage(error, fallback);
  }

  return fallback;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) {
    return 'Unknown device';
  }

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Safari\//.test(userAgent)
        ? 'Safari'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : 'Browser';

  const platform = /iPhone|iPad|iPod/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Macintosh|Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'an unknown OS';

  return `${browser} on ${platform}`;
}

export function Account() {
  const { user } = useAuthContext();

  if (!user) {
    return null;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <ProfileSection user={user} />
      <PasswordSection />
      <SessionsSection />
      <DeleteAccountSection user={user} />
    </div>
  );
}

function SuccessNote({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
    >
      {message}
    </p>
  );
}

function ProfileSection({ user }: { user: AuthUser }) {
  const { applyUser } = useAuthContext();

  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [email, setEmail] = useState(user.email);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api.auth.updateProfile({
        displayName: displayName.trim() === '' ? null : displayName.trim(),
        email: email.trim(),
      }),
    onSuccess: (result) => {
      applyUser(result.user);
      setSaved(true);
      setError(null);
    },
    onError: (caught) => {
      setSaved(false);
      setError(mutationErrorMessage(caught, 'Could not save your profile.'));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    setSaved(false);
    mutation.mutate();
  }

  const unchanged =
    (displayName.trim() === '' ? null : displayName.trim()) === (user.displayName ?? null) &&
    email.trim().toLowerCase() === user.email;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="h-4 w-4" />
          Profile
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <label htmlFor="displayName" className="text-sm font-medium">
              Display name
            </label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={100}
              disabled={mutation.isPending}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={mutation.isPending}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="account-username" className="text-sm font-medium">
              Username
            </label>
            <Input
              id="account-username"
              value={user.username}
              readOnly
              disabled
              aria-describedby="account-username-hint"
            />
            <p id="account-username-hint" className="text-xs text-muted-foreground">
              Usernames are permanent. Ask an administrator if you need a different one.
            </p>
          </div>

          {error && (
            <InlineError message={error} onDismiss={() => setError(null)} />
          )}
          {saved && <SuccessNote message="Profile saved." />}

          <Button type="submit" size="sm" className="gap-2" disabled={mutation.isPending || unchanged}>
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Save profile
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordSection() {
  const { applyUser } = useAuthContext();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.auth.changePassword({ currentPassword, newPassword }),
    onSuccess: (result) => {
      applyUser(result.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      setSaved(
        result.otherSessionsRevoked > 0
          ? `Password changed. ${result.otherSessionsRevoked} other ${
              result.otherSessionsRevoked === 1 ? 'device was' : 'devices were'
            } signed out.`
          : 'Password changed.'
      );
    },
    onError: (caught) => {
      setSaved(null);
      setError(mutationErrorMessage(caught, 'Could not change your password.'));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(null);

    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }

    setError(null);
    mutation.mutate();
  }

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    !mutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          Password
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <label htmlFor="currentPassword" className="text-sm font-medium">
              Current password
            </label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={mutation.isPending}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="newPassword" className="text-sm font-medium">
              New password
            </label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={mutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              At least 12 characters, and not your username or email address.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm new password
            </label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={mutation.isPending}
            />
          </div>

          {error && <InlineError message={error} onDismiss={() => setError(null)} />}
          {saved && <SuccessNote message={saved} />}

          <Button type="submit" size="sm" className="gap-2" disabled={!canSubmit}>
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            )}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, error: queryError, refetch } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.auth.sessions(),
  });

  const revokeOthers = useMutation({
    mutationFn: () => api.auth.revokeOtherSessions(),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (caught) =>
      setError(mutationErrorMessage(caught, 'Could not sign out the other devices.')),
  });

  const revokeOne = useMutation({
    mutationFn: (id: string) => api.auth.revokeSession(id),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (caught) => setError(mutationErrorMessage(caught, 'Could not sign out that device.')),
  });

  const sessions: SessionSummary[] = data?.sessions ?? [];
  const otherCount = sessions.filter((session) => !session.current).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorSmartphone className="h-4 w-4" />
          Signed-in devices
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Every browser holding a session for your account. Signing out other devices is
          useful after using a shared computer.
        </p>

        {error && <InlineError message={error} onDismiss={() => setError(null)} />}

        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => revokeOthers.mutate()}
          disabled={revokeOthers.isPending || otherCount === 0}
        >
          {revokeOthers.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="h-4 w-4" aria-hidden="true" />
          )}
          Sign out other devices
        </Button>

        {isLoading ? (
          <QueryState isLoading loadingLabel="Loading devices…" className="py-8" />
        ) : isError ? (
          <QueryState
            isError
            error={queryError}
            errorTitle="Could not load your devices"
            onRetry={() => refetch()}
            className="py-8"
          />
        ) : sessions.length === 0 ? (
          <QueryState
            isEmpty
            emptyTitle="No sessions"
            emptyDescription="Sign in again to see this device listed."
          />
        ) : (
          <ul className="divide-y">
            {sessions.map((session) => (
              <li key={session.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {describeDevice(session.userAgent)}
                    {session.current && (
                      <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last seen {formatDate(session.lastSeenAt)}
                    {session.ip ? ` · ${session.ip}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Signed in {formatDate(session.createdAt)}
                  </p>
                </div>
                {!session.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-destructive hover:text-destructive"
                    onClick={() => revokeOne.mutate(session.id)}
                    disabled={revokeOne.isPending}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DeleteAccountSection({ user }: { user: AuthUser }) {
  const { refresh } = useAuthContext();

  const [password, setPassword] = useState('');
  const [confirmUsername, setConfirmUsername] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.auth.deleteAccount({ password, confirmUsername }),
    onSuccess: async () => {
      // The account and its session are gone; the gate will show sign-in.
      await refresh();
    },
    onError: (caught) => {
      setError(mutationErrorMessage(caught, 'Could not delete your account.'));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    setError(null);
    mutation.mutate();
  }

  const confirmed = confirmUsername.trim() === user.username;

  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Delete account
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          This permanently deletes your account, your categories, every time entry and
          your settings. It cannot be undone.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <label htmlFor="delete-confirm" className="text-sm font-medium">
              Type <span className="font-mono">{user.username}</span> to confirm
            </label>
            <Input
              id="delete-confirm"
              value={confirmUsername}
              onChange={(event) => setConfirmUsername(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={mutation.isPending}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="delete-password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={mutation.isPending}
            />
          </div>

          {error && <InlineError message={error} onDismiss={() => setError(null)} />}

          <Button
            type="submit"
            size="sm"
            variant="destructive"
            className="gap-2"
            disabled={mutation.isPending || !confirmed || password.length === 0}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            )}
            Delete my account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
