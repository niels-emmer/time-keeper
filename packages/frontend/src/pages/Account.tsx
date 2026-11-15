import { useState, useEffect, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InlineError, QueryState } from '@/components/QueryState';
import {
  api,
  getErrorMessage,
  type AuthUser,
  type MfaEnrolment,
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
 * again, which is a different answer from "you are not allowed". That mapping
 * lives in `getErrorMessage`, so every auth surface answers it identically.
 */

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
      <MfaSection user={user} />
      <SessionsSection />
      <DeleteAccountSection user={user} />
    </div>
  );
}

function SuccessNote({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="rounded-xl border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
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
      setError(getErrorMessage(caught, 'Could not save your profile.'));
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
      setError(getErrorMessage(caught, 'Could not change your password.'));
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
      setError(getErrorMessage(caught, 'Could not sign out the other devices.')),
  });

  const revokeOne = useMutation({
    mutationFn: (id: string) => api.auth.revokeSession(id),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (caught) => setError(getErrorMessage(caught, 'Could not sign out that device.')),
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
      setError(getErrorMessage(caught, 'Could not delete your account.'));
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

/** Group a base32 secret the way authenticator apps display it for manual entry. */
function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * The `otpauth://` URI rendered as a QR code, entirely in the browser.
 *
 * `qrcode` is the only new dependency in Phase D: MIT, no network access, and
 * it renders to a data URL so the secret never leaves this tab. A hand-written
 * QR encoder would be far more code and far more risk than the problem is worth.
 */
function EnrolmentQrCode({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    try {
      QRCode.toDataURL(value, { margin: 1, width: 216, errorCorrectionLevel: 'M' })
        .then((url) => {
          if (!cancelled) setDataUrl(url);
        })
        .catch(() => {
          // The secret is still shown as text below, so a failed render is not fatal.
          if (!cancelled) setDataUrl(null);
        });
    } catch {
      setDataUrl(null);
    }

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!dataUrl) {
    return (
      <div className="flex h-[216px] w-[216px] items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
        Preparing QR code…
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      width={216}
      height={216}
      alt="QR code for your authenticator app"
      className="rounded-xl border bg-white p-2"
    />
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" className="gap-2" onClick={copy}>
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {copied ? 'Copied' : label}
    </Button>
  );
}

/**
 * Recovery codes, shown exactly once.
 *
 * They are displayed after confirmation and after a regeneration — the only two
 * moments the server ever has the plaintext. Dismissing this panel is the end of
 * them, which the copy says plainly.
 */
function RecoveryCodesPanel({
  codes,
  onDismiss,
}: {
  codes: string[];
  onDismiss: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-medium">Save these recovery codes now.</p>
        <p className="text-xs opacity-80">
          Each code works once, and this is the only time they are shown. Keep them somewhere
          safe — they are how you get back in if you lose your authenticator.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-2 font-mono text-sm" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code} className="rounded-md border bg-muted/40 px-2 py-1.5 tracking-wide">
            {code}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <CopyButton value={codes.join('\n')} label="Copy all codes" />
        <Button type="button" size="sm" onClick={onDismiss}>
          I have saved these codes
        </Button>
      </div>
    </div>
  );
}

/**
 * Two-factor authentication (Phase D, D3/Q8).
 *
 * Three states, and each one is deliberate:
 *
 *   not enrolled → one button. Enrolling issues a *pending* secret; login is
 *                  unchanged until the pending code is confirmed.
 *   enrolling    → QR + manual key + a confirm field. The card says plainly
 *                  that nothing is active yet, because a half-finished setup
 *                  that silently protects nothing is worse than none.
 *   enrolled     → regenerate (password) or disable (password + freshness).
 *
 * Administrators who have not enrolled see the Q8 warning: the backend refuses
 * their admin routes with `mfa_enrolment_required`, so this is their route out.
 */
function MfaSection({ user }: { user: AuthUser }) {
  const { refresh } = useAuthContext();

  const [enrolment, setEnrolment] = useState<MfaEnrolment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordFor, setPasswordFor] = useState<'disable' | 'regenerate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const enrol = useMutation({
    mutationFn: () => api.auth.enrolMfa(),
    onSuccess: (result) => {
      setEnrolment(result);
      setConfirmCode('');
      setError(null);
      setNote(null);
    },
    onError: (caught) => setError(getErrorMessage(caught, 'Could not start MFA setup.')),
  });

  const confirm = useMutation({
    mutationFn: () => api.auth.confirmMfa(confirmCode.trim()),
    onSuccess: async (result) => {
      setRecoveryCodes(result.recoveryCodes);
      setEnrolment(null);
      setConfirmCode('');
      setError(null);
      await refresh();
    },
    onError: (caught) => setError(getErrorMessage(caught, 'Could not confirm that code.')),
  });

  const disable = useMutation({
    mutationFn: () => api.auth.disableMfa(password),
    onSuccess: async () => {
      setPassword('');
      setPasswordFor(null);
      setRecoveryCodes(null);
      setError(null);
      setNote('Two-factor authentication is off. Your account is protected by your password only.');
      await refresh();
    },
    onError: (caught) =>
      setError(getErrorMessage(caught, 'Could not disable two-factor authentication.')),
  });

  const regenerate = useMutation({
    mutationFn: () => api.auth.regenerateRecoveryCodes(password),
    onSuccess: (result) => {
      setRecoveryCodes(result.recoveryCodes);
      setPassword('');
      setPasswordFor(null);
      setError(null);
      setNote(null);
    },
    onError: (caught) =>
      setError(getErrorMessage(caught, 'Could not regenerate your recovery codes.')),
  });

  const pending = enrol.isPending || confirm.isPending || disable.isPending || regenerate.isPending;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Two-factor authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {user.role === 'admin' && !user.mfaEnabled && !recoveryCodes && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Administrator accounts must enable two-factor authentication. Administrator
              features stay locked until it is on.
            </span>
          </div>
        )}

        {note && <SuccessNote message={note} />}
        {error && <InlineError message={error} onDismiss={() => setError(null)} />}

        {recoveryCodes ? (
          <RecoveryCodesPanel
            codes={recoveryCodes}
            onDismiss={() => {
              setRecoveryCodes(null);
              setNote('Two-factor authentication is on. Keep your recovery codes somewhere safe.');
            }}
          />
        ) : user.mfaEnabled ? (
          <>
            <p className="text-sm text-muted-foreground">
              Two-factor authentication is on. Signing in needs your password and a code from
              your authenticator app.
            </p>

            {passwordFor === null ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setPasswordFor('regenerate');
                    setPassword('');
                    setError(null);
                  }}
                >
                  Regenerate recovery codes
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={pending}
                  onClick={() => {
                    setPasswordFor('disable');
                    setPassword('');
                    setError(null);
                  }}
                >
                  Turn off
                </Button>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (pending || password.length === 0) return;
                  if (passwordFor === 'disable') disable.mutate();
                  else regenerate.mutate();
                }}
              >
                <div className="space-y-2">
                  <label htmlFor="mfa-password" className="text-sm font-medium">
                    Password
                  </label>
                  <Input
                    id="mfa-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={pending}
                  />
                  <p className="text-xs text-muted-foreground">
                    {passwordFor === 'disable'
                      ? 'Your password is required, and this needs a sign-in from the last five minutes. Turning this off deletes your recovery codes.'
                      : 'Your password is required, and this needs a sign-in from the last five minutes. Your old codes stop working immediately.'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    variant={passwordFor === 'disable' ? 'destructive' : 'default'}
                    className="gap-2"
                    disabled={pending || password.length === 0}
                  >
                    {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {passwordFor === 'disable' ? 'Turn off two-factor' : 'Regenerate codes'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setPasswordFor(null);
                      setPassword('');
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </>
        ) : enrolment ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row">
              <EnrolmentQrCode value={enrolment.otpauthUri} />

              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Scan the code with your authenticator app, or add this key by hand:
                </p>
                <p className="select-all break-all rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs">
                  {groupSecret(enrolment.secret)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={enrolment.secret} label="Copy key" />
                  <CopyButton value={enrolment.otpauthUri} label="Copy setup link" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Time-based codes: SHA-1, 6 digits, 30 seconds.
                </p>
              </div>
            </div>

            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (pending || confirmCode.trim().length === 0) return;
                confirm.mutate();
              }}
            >
              <div className="space-y-2">
                <label htmlFor="mfa-confirm-code" className="text-sm font-medium">
                  Enter the 6-digit code to finish setup
                </label>
                <Input
                  id="mfa-confirm-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  className="max-w-[10rem] font-mono tracking-[0.4em]"
                  value={confirmCode}
                  onChange={(event) => setConfirmCode(event.target.value)}
                  disabled={pending}
                />
                <p className="text-xs text-muted-foreground">
                  Nothing is active until this code is confirmed — signing in still uses your
                  password alone.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  className="gap-2"
                  disabled={pending || confirmCode.trim().length === 0}
                >
                  {confirm.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  )}
                  Confirm and turn on
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setEnrolment(null);
                    setConfirmCode('');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Add a second step to signing in: your password plus a 6-digit code from an
              authenticator app. You will also get ten single-use recovery codes.
            </p>
            <Button
              type="button"
              size="sm"
              className="gap-2"
              disabled={pending}
              onClick={() => enrol.mutate()}
            >
              {enrol.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              )}
              Set up two-factor authentication
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
