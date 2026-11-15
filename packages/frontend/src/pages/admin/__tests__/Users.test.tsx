import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUser } from '@/lib/api';
import { AdminUsers } from '../Users';

const { adminApi, authState } = vi.hoisted(() => ({
  adminApi: {
    users: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    resetUser: vi.fn(),
    authEvents: vi.fn(),
  },
  authState: {
    user: { id: 'admin-1', username: 'boss', role: 'admin' as const },
    mfaEnrolmentRequired: false,
  },
}));

vi.mock('@/lib/authContext', () => ({
  useAuthContext: () => authState,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, admin: adminApi } };
});

const ADMIN: AdminUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  username: 'boss',
  displayName: null,
  role: 'admin',
  disabled: false,
  mfaEnabled: true,
  mustSetPassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: '2026-02-01T10:00:00.000Z',
  entryCount: 3,
};

const BOB: AdminUser = {
  id: 'user-2',
  email: 'bob@example.com',
  username: 'bob',
  displayName: null,
  role: 'user',
  disabled: false,
  mfaEnabled: false,
  mustSetPassword: false,
  createdAt: '2026-01-02T00:00:00.000Z',
  lastLoginAt: null,
  entryCount: 7,
};

function renderUsers() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminUsers />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.mfaEnrolmentRequired = false;
  adminApi.users.mockResolvedValue({ users: [ADMIN, BOB] });
  adminApi.createUser.mockResolvedValue({
    user: { ...BOB, id: 'user-3', email: 'new@example.com', username: 'newuser' },
    resetCode: 'reset-code-value',
    resetExpiresAt: '2026-11-15T12:00:00.000Z',
  });
  adminApi.updateUser.mockResolvedValue({ user: { ...BOB, role: 'admin' } });
  adminApi.deleteUser.mockResolvedValue({
    deleted: true,
    mode: 'reassign',
    entriesReassigned: 7,
    categoriesMoved: 1,
    categoriesMerged: 0,
  });
  adminApi.resetUser.mockResolvedValue({
    resetCode: 'another-reset-code',
    expiresAt: '2026-11-15T12:00:00.000Z',
  });
});

describe('AdminUsers', () => {
  it('lists accounts with role, status and entry count', async () => {
    renderUsers();

    expect(await screen.findByText('bob')).not.toBeNull();
    expect(screen.getByText('bob@example.com')).not.toBeNull();
    // Entry count, MFA state and last sign-in share one summary line so all of
    // them stay visible at 390px.
    expect(screen.getByText(/7 entries/)).not.toBeNull();
    expect(screen.getByText('Admin')).not.toBeNull();
    // The controls are visible without horizontal scrolling: one of each is
    // rendered per account.
    expect(screen.getByRole('button', { name: 'Delete bob' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Make user boss' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Make admin bob' })).not.toBeNull();
  });

  it('creates an account and shows the reset code exactly once', async () => {
    renderUsers();
    await screen.findByText('bob');

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'newuser' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));

    expect(await screen.findByDisplayValue('reset-code-value')).not.toBeNull();
    expect(adminApi.createUser).toHaveBeenCalledWith({
      email: 'new@example.com',
      username: 'newuser',
      role: 'user',
    });
    expect(screen.getByText(/hand it over out of band/i)).not.toBeNull();
  });

  it('requires the typed username and sends the chosen delete mode', async () => {
    renderUsers();
    await screen.findByText('bob');

    fireEvent.click(screen.getByRole('button', { name: 'Delete bob' }));
    const confirmDelete = screen.getByRole('button', { name: /delete account/i });
    expect((confirmDelete as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/type bob to confirm/i), {
      target: { value: 'bob' },
    });
    expect((confirmDelete as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(confirmDelete);

    await waitFor(() =>
      expect(adminApi.deleteUser).toHaveBeenCalledWith('user-2', 'reassign')
    );
  });

  it('explains the MFA requirement instead of loading a table it cannot read', () => {
    authState.mfaEnrolmentRequired = true;
    renderUsers();

    expect(screen.getByText(/two-factor authentication must be enabled/i)).not.toBeNull();
    expect(adminApi.users).not.toHaveBeenCalled();
  });
});
