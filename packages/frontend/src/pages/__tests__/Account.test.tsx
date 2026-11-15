import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ForbiddenError, type AuthUser, type SessionSummary } from '@/lib/api';
import { Account } from '../Account';

const { userState, apiMock } = vi.hoisted(() => ({
  userState: {
    user: null as AuthUser | null,
    applyUser: vi.fn(),
    refresh: vi.fn(),
  },
  apiMock: {
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    deleteAccount: vi.fn(),
    sessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(),
    enrolMfa: vi.fn(),
    confirmMfa: vi.fn(),
    disableMfa: vi.fn(),
    regenerateRecoveryCodes: vi.fn(),
  },
}));

vi.mock('@/lib/authContext', () => ({
  useAuthContext: () => userState,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, auth: { ...actual.api.auth, ...apiMock } } };
});

const USER: AuthUser = {
  id: 'user-1',
  email: 'alice@example.com',
  username: 'alice',
  displayName: null,
  role: 'user',
  mfaEnabled: false,
  mustSetPassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
};

function sessions(): SessionSummary[] {
  return [
    {
      id: 'current-hash',
      createdAt: '2026-01-01T09:00:00.000Z',
      lastSeenAt: '2026-01-01T09:30:00.000Z',
      expiresAt: '2026-01-15T09:00:00.000Z',
      absoluteExpiresAt: '2026-04-01T09:00:00.000Z',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1',
      ip: '10.0.0.5',
      current: true,
    },
    {
      id: 'other-hash',
      createdAt: '2026-01-02T09:00:00.000Z',
      lastSeenAt: '2026-01-02T09:30:00.000Z',
      expiresAt: '2026-01-16T09:00:00.000Z',
      absoluteExpiresAt: '2026-04-02T09:00:00.000Z',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Chrome/120',
      ip: '10.0.0.6',
      current: false,
    },
  ];
}

function renderAccount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Account />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Account', () => {
  beforeEach(() => {
    userState.user = USER;
    userState.applyUser.mockReset();
    userState.refresh.mockReset();
    Object.values(apiMock).forEach((mock) => mock.mockReset());
    apiMock.sessions.mockResolvedValue({ currentSessionId: 'current-hash', sessions: sessions() });
  });

  it('shows the username read-only so it cannot look editable', () => {
    renderAccount();

    const username = screen.getByLabelText('Username') as HTMLInputElement;
    expect(username.value).toBe('alice');
    expect(username.disabled).toBe(true);
    expect(screen.getByText(/Usernames are permanent/i)).toBeTruthy();
  });

  it('surfaces an email conflict instead of silently reverting', async () => {
    apiMock.updateProfile.mockRejectedValue(
      new ApiError('An account with that email already exists.', 409, 'email_taken')
    );

    renderAccount();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'taken@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    expect(
      await screen.findByText('An account with that email already exists.')
    ).toBeTruthy();
  });

  it('lists devices and only offers sign-out for the other ones', async () => {
    renderAccount();

    expect(await screen.findByText('Safari on macOS')).toBeTruthy();
    expect(await screen.findByText('Chrome on iOS')).toBeTruthy();
    expect(screen.getByText('This device')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
  });

  it('signs out the other devices', async () => {
    apiMock.revokeOtherSessions.mockResolvedValue({ revoked: 1 });

    renderAccount();
    await screen.findByText('Safari on macOS');

    fireEvent.click(screen.getByRole('button', { name: /sign out other devices/i }));

    await waitFor(() => expect(apiMock.revokeOtherSessions).toHaveBeenCalled());
  });

  it('explains the five-minute freshness gate on the password form (Q17)', async () => {
    apiMock.changePassword.mockRejectedValue(
      new ForbiddenError('Re-authentication required', 'reauthentication_required')
    );

    renderAccount();

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'alice password is long' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'an entirely different passphrase' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'an entirely different passphrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText(/needs a fresh sign-in/i)).toBeTruthy();
  });

  it('walks through enrolment: secret shown, then recovery codes once', async () => {
    apiMock.enrolMfa.mockResolvedValue({
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      otpauthUri: 'otpauth://totp/Time%20Keeper:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    apiMock.confirmMfa.mockResolvedValue({
      recoveryCodes: [
        'ABCDE-FGHJK',
        '23456-789AB',
        'CDEFG-HJKLM',
        'NPQRS-TUVWX',
        'YZ234-56789',
        'ABCDE-23456',
        'CDEFG-789AB',
        'NPQRS-HJKLM',
        'TUVWX-YZ234',
        '56789-ABCDE',
      ],
    });

    renderAccount();

    fireEvent.click(
      await screen.findByRole('button', { name: /set up two-factor authentication/i })
    );

    // The secret is available for manual entry, grouped for reading.
    expect(await screen.findByText(/GEZD GNBV GY3T QOJQ/i)).toBeTruthy();
    expect(screen.getByText(/Nothing is active until this code is confirmed/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Enter the 6-digit code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm and turn on/i }));

    await waitFor(() => expect(apiMock.confirmMfa).toHaveBeenCalledWith('123456'));

    // Codes are shown once, with the warning that makes them worth saving.
    expect(await screen.findByText('ABCDE-FGHJK')).toBeTruthy();
    expect(screen.getByText(/Save these recovery codes now/i)).toBeTruthy();
    expect(userState.refresh).toHaveBeenCalled();
  });

  it('prompts an administrator who has not enrolled to set up MFA (Q8)', () => {
    userState.user = { ...USER, role: 'admin' };

    renderAccount();

    expect(
      screen.getByText(/Administrator accounts must enable two-factor authentication/i)
    ).toBeTruthy();
  });

  it('requires the password before turning MFA off', async () => {
    userState.user = { ...USER, mfaEnabled: true };

    renderAccount();

    fireEvent.click(screen.getByRole('button', { name: /^turn off$/i }));
    // The delete section also has a "Password" field; the MFA card comes first.
    fireEvent.change(screen.getAllByLabelText('Password')[0], {
      target: { value: 'alice password is long' },
    });
    fireEvent.click(screen.getByRole('button', { name: /turn off two-factor/i }));

    await waitFor(() =>
      expect(apiMock.disableMfa).toHaveBeenCalledWith('alice password is long')
    );
  });

  it('requires the typed username and the password before deletion can be submitted', async () => {
    renderAccount();

    const confirm = screen.getByLabelText(/to confirm/i);
    const password = screen.getByLabelText('Password');
    const submit = screen.getByRole('button', { name: /delete my account/i }) as HTMLButtonElement;

    expect(submit.disabled).toBe(true);

    fireEvent.change(confirm, { target: { value: 'alice' } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(password, { target: { value: 'alice password is long' } });
    expect(submit.disabled).toBe(false);

    fireEvent.change(confirm, { target: { value: 'wrong' } });
    expect(submit.disabled).toBe(true);
  });
});
