import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserPlus,
  Users as UsersIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InlineError, QueryState } from '@/components/QueryState';
import {
  ForbiddenError,
  api,
  getErrorMessage,
  type AdminDeleteMode,
  type AdminUser,
  type AdminUserRecord,
} from '@/lib/api';
import { useAuthContext } from '@/lib/authContext';

/**
 * Administrator user management (Phase E, Q11/Q16).
 *
 * Deliberately minimal: create, role toggle, disable/enable, reset code and
 * delete. No bulk operations, no cross-user session administration and no
 * force-MFA-reset — the target scale is 2–10 users.
 *
 * The component is mounted only for `role === 'admin'` (Settings). A local
 * administrator who has not enrolled MFA gets the backend's
 * `mfa_enrolment_required` answer; the card explains it instead of rendering a
 * table that would fail to load.
 */

/** Q17: a stale session is a different answer from "not allowed". */
function actionMessage(error: unknown, fallback: string): string {
  if (error instanceof ForbiddenError && error.code === 'reauthentication_required') {
    return 'For your security this needs a fresh sign-in. Sign out and sign back in, then try again.';
  }
  return getErrorMessage(error, fallback);
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'Never';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function resetExpiryLabel(expiresAt: string): string {
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return expiresAt;
  }
  return parsed.toLocaleTimeString(undefined, { timeStyle: 'short' });
}

/** A reset code is shown once, with copy, and never fetched again. */
function ResetCodePanel({ code, expiresAt }: { code: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-3 py-2">
      <p className="text-sm text-muted-foreground">
        Copy this code now and hand it over out of band. It works once, expires at{' '}
        {resetExpiryLabel(expiresAt)}, and will not be shown again.
      </p>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          aria-label="Password reset code"
          value={code}
          className="font-mono text-xs"
          onFocus={(event) => event.target.select()}
        />
        <Button size="sm" variant="outline" className="shrink-0" onClick={handleCopy}>
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          <span className="sr-only">Copy reset code</span>
        </Button>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: 'user' | 'admin' }) {
  return role === 'admin' ? (
    <Badge className="gap-1">
      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      Admin
    </Badge>
  ) : (
    <Badge variant="secondary">User</Badge>
  );
}

export function AdminUsers() {
  const qc = useQueryClient();
  const { user: currentUser, mfaEnrolmentRequired } = useAuthContext();

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Create
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createRole, setCreateRole] = useState<'user' | 'admin'>('user');
  const [created, setCreated] = useState<{ user: AdminUserRecord; code: string; expiresAt: string } | null>(null);

  // Reset
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetCode, setResetCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteMode, setDeleteMode] = useState<AdminDeleteMode>('reassign');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.admin.users(),
    enabled: !mfaEnrolmentRequired,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.admin.createUser({
        email: createEmail.trim(),
        username: createUsername.trim().toLowerCase(),
        role: createRole,
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setCreated({ user: result.user, code: result.resetCode, expiresAt: result.resetExpiresAt });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; payload: { role?: 'user' | 'admin'; disabled?: boolean } }) =>
      api.admin.updateUser(input.id, input.payload),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setActionError(null);
      setNotice(`Updated ${result.user.username}.`);
    },
    onError: (caught) => {
      setNotice(null);
      setActionError(actionMessage(caught, 'Could not update that account.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (input: { id: string; mode: AdminDeleteMode }) =>
      api.admin.deleteUser(input.id, input.mode),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setDeleteTarget(null);
      setNotice(
        result.mode === 'reassign'
          ? `Account deleted. ${result.entriesReassigned} ${
              result.entriesReassigned === 1 ? 'entry was' : 'entries were'
            } moved to you.`
          : 'Account and all of its data were deleted.'
      );
    },
    onError: (caught) => {
      setDeleteError(actionMessage(caught, 'Could not delete that account.'));
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => api.admin.resetUser(id),
    onSuccess: (result) => {
      setResetCode({ code: result.resetCode, expiresAt: result.expiresAt });
      setResetError(null);
    },
    onError: (caught) => {
      setResetError(actionMessage(caught, 'Could not issue a reset code.'));
    },
  });

  function openCreate() {
    setCreated(null);
    setCreateEmail('');
    setCreateUsername('');
    setCreateRole('user');
    createMutation.reset();
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    setCreated(null);
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createMutation.isPending) return;
    createMutation.mutate();
  }

  function openReset(target: AdminUser) {
    setResetTarget(target);
    setResetCode(null);
    setResetError(null);
    resetMutation.reset();
  }

  function closeReset() {
    setResetTarget(null);
    setResetCode(null);
    setResetError(null);
  }

  function openDelete(target: AdminUser) {
    setDeleteTarget(target);
    setDeleteMode('reassign');
    setDeleteConfirm('');
    setDeleteError(null);
    deleteMutation.reset();
  }

  function closeDelete() {
    setDeleteTarget(null);
    setDeleteConfirm('');
    setDeleteError(null);
  }

  if (mfaEnrolmentRequired) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <UsersIcon className="h-4 w-4" />
            Users
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Two-factor authentication must be enabled before you can manage accounts. Enable it in
            your Account settings, then return here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <UsersIcon className="h-4 w-4" />
            Users
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Accounts that can sign in to this instance. New accounts receive a one-time reset code
            so their owner chooses their own password.
          </p>

          <Button size="sm" variant="outline" className="mb-4 gap-1" onClick={openCreate}>
            <UserPlus className="h-4 w-4" />
            New user
          </Button>

          {notice && <p className="mb-3 text-sm text-muted-foreground">{notice}</p>}
          {actionError && (
            <InlineError message={actionError} onDismiss={() => setActionError(null)} className="mb-3" />
          )}

          <QueryState
            isLoading={isLoading}
            isError={isError}
            error={error}
            errorTitle="Could not load users"
            onRetry={() => refetch()}
            isEmpty={!isLoading && !isError && (data?.users.length ?? 0) === 0}
            emptyTitle="No accounts yet"
            className="py-8"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Account</th>
                    <th className="pb-2 font-medium">Role</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">MFA</th>
                    <th className="pb-2 font-medium">Entries</th>
                    <th className="pb-2 font-medium">Last sign-in</th>
                    <th className="pb-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.users.map((account) => {
                    const isSelf = account.id === currentUser?.id;
                    const pending = updateMutation.isPending && updateMutation.variables?.id === account.id;

                    return (
                      <tr key={account.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{account.username}</span>
                            {isSelf && <Badge variant="outline">You</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">{account.email}</p>
                        </td>
                        <td className="py-2 pr-4">
                          <RoleBadge role={account.role} />
                        </td>
                        <td className="py-2 pr-4">
                          {account.disabled ? (
                            <Badge variant="destructive">Disabled</Badge>
                          ) : (
                            <Badge variant="outline">Active</Badge>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {account.mfaEnabled ? 'Enabled' : 'Off'}
                        </td>
                        <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                          {account.entryCount}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {formatDate(account.lastLoginAt)}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-xs"
                              aria-label={`${account.role === 'admin' ? 'Make user' : 'Make admin'} ${account.username}`}
                              disabled={pending}
                              onClick={() =>
                                updateMutation.mutate({
                                  id: account.id,
                                  payload: { role: account.role === 'admin' ? 'user' : 'admin' },
                                })
                              }
                            >
                              {account.role === 'admin' ? (
                                <ShieldOff className="h-3.5 w-3.5" />
                              ) : (
                                <ShieldCheck className="h-3.5 w-3.5" />
                              )}
                              {account.role === 'admin' ? 'Make user' : 'Make admin'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-xs"
                              aria-label={`${account.disabled ? 'Enable' : 'Disable'} ${account.username}`}
                              disabled={pending}
                              onClick={() =>
                                updateMutation.mutate({
                                  id: account.id,
                                  payload: { disabled: !account.disabled },
                                })
                              }
                            >
                              {account.disabled ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <Ban className="h-3.5 w-3.5" />
                              )}
                              {account.disabled ? 'Enable' : 'Disable'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-xs"
                              aria-label={`Issue reset code for ${account.username}`}
                              onClick={() => openReset(account)}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              Reset
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              aria-label={`Delete ${account.username}`}
                              onClick={() => openDelete(account)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </QueryState>
        </CardContent>
      </Card>

      {/* Create user */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) closeCreate(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
          </DialogHeader>

          {created ? (
            <>
              <p className="text-sm">
                Created <span className="font-medium">{created.user.username}</span>. Give them this
                reset code so they can set their own password.
              </p>
              <ResetCodePanel code={created.code} expiresAt={created.expiresAt} />
              <DialogFooter>
                <Button onClick={closeCreate}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleCreate} className="space-y-3 py-1" noValidate>
              <div className="space-y-2">
                <label htmlFor="admin-new-email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="admin-new-email"
                  type="email"
                  autoComplete="off"
                  value={createEmail}
                  onChange={(event) => setCreateEmail(event.target.value)}
                  disabled={createMutation.isPending}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="admin-new-username" className="text-sm font-medium">
                  Username
                </label>
                <Input
                  id="admin-new-username"
                  value={createUsername}
                  onChange={(event) => setCreateUsername(event.target.value.toLowerCase())}
                  maxLength={32}
                  disabled={createMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  3–32 characters: lowercase letters, numbers, hyphens and underscores. Permanent.
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="admin-new-role" className="text-sm font-medium">
                  Role
                </label>
                <select
                  id="admin-new-role"
                  value={createRole}
                  onChange={(event) => setCreateRole(event.target.value as 'user' | 'admin')}
                  disabled={createMutation.isPending}
                  className="w-full rounded-md border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              {createMutation.isError && (
                <InlineError
                  message={actionMessage(createMutation.error, 'Could not create that account.')}
                />
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeCreate}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!createEmail.trim() || !createUsername.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    'Create user'
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Reset code */}
      <Dialog open={resetTarget !== null} onOpenChange={(open) => { if (!open) closeReset(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset password for {resetTarget?.username}</DialogTitle>
          </DialogHeader>

          {resetCode ? (
            <>
              <ResetCodePanel code={resetCode.code} expiresAt={resetCode.expiresAt} />
              <p className="text-xs text-muted-foreground">
                Redeeming the code signs the account out everywhere and clears its must-set-password
                flag.
              </p>
              <DialogFooter>
                <Button onClick={closeReset}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                This invalidates any earlier code for this account. The person chooses a new
                password; you never see it.
              </p>
              {resetError && <InlineError message={resetError} />}
              <DialogFooter>
                <Button variant="outline" onClick={closeReset}>
                  Cancel
                </Button>
                <Button
                  className="gap-1"
                  disabled={resetMutation.isPending || resetTarget === null}
                  onClick={() => resetTarget && resetMutation.mutate(resetTarget.id)}
                >
                  {resetMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  Issue reset code
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete with cascade-vs-reassign and typed confirmation (Q16, D6) */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) closeDelete(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.username}?</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This cannot be undone. Choose what happens to the account&apos;s time entries.
            </p>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="delete-mode"
                className="mt-1"
                checked={deleteMode === 'reassign'}
                onChange={() => setDeleteMode('reassign')}
              />
              <span>
                <span className="font-medium">Move entries to me</span>
                <span className="block text-xs text-muted-foreground">
                  Reassigns time entries and categories to your account. Categories whose name you
                  already use are merged into yours.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="delete-mode"
                className="mt-1"
                checked={deleteMode === 'cascade'}
                onChange={() => setDeleteMode('cascade')}
              />
              <span>
                <span className="font-medium">Delete everything</span>
                <span className="block text-xs text-muted-foreground">
                  Permanently removes the account and all of its entries, categories and settings.
                </span>
              </span>
            </label>

            <div className="space-y-2">
              <label htmlFor="admin-delete-confirm" className="text-sm font-medium">
                Type <span className="font-mono">{deleteTarget?.username}</span> to confirm
              </label>
              <Input
                id="admin-delete-confirm"
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                autoComplete="off"
              />
            </div>

            {deleteError && <InlineError message={deleteError} />}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDelete}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                deleteTarget === null ||
                deleteConfirm.trim() !== deleteTarget.username ||
                deleteMutation.isPending
              }
              onClick={() =>
                deleteTarget &&
                deleteMutation.mutate({ id: deleteTarget.id, mode: deleteMode })
              }
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                'Delete account'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
