import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { Register } from '../Register';

const { acceptInviteMock, refreshMock } = vi.hoisted(() => ({
  acceptInviteMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('@/lib/authContext', () => ({
  useAuthContext: () => ({ refresh: refreshMock }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, acceptInvite: acceptInviteMock },
    },
  };
});

function renderRegister(path = '/register?token=invite-token') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Register />
    </MemoryRouter>
  );
}

async function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newcomer' } });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'a much longer passphrase' },
  });
}

describe('Register', () => {
  beforeEach(() => {
    acceptInviteMock.mockReset();
    refreshMock.mockReset();
  });

  it('asks for a link when the token is missing instead of showing a dead form', () => {
    renderRegister('/register');

    expect(screen.getByText('Invitation required')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('keeps submit disabled until the password meets the inline policy', async () => {
    renderRegister();

    const submit = screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement;

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newcomer' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });

    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a much longer passphrase' },
    });

    expect(submit.disabled).toBe(false);
  });

  it('shows every rule the API checks, including the denylist', () => {
    renderRegister();

    const list = screen.getByLabelText('Password requirements');
    const labels = Array.from(list.querySelectorAll('li')).map((item) => item.textContent ?? '');

    expect(labels).toHaveLength(4);
    expect(labels[0]).toMatch(/at least 12 characters/i);
    expect(labels[1]).toMatch(/username/i);
    expect(labels[2]).toMatch(/email address/i);
    expect(labels[3]).toMatch(/common or easily guessed/i);
  });

  it('does not tick content rules before a password is typed', () => {
    renderRegister();

    const list = screen.getByLabelText('Password requirements');
    const items = Array.from(list.querySelectorAll('li'));

    // None of the four is satisfied by an empty field — the old checklist went
    // green for "does not contain your username" before anything was typed.
    expect(items.every((item) => !item.className.includes('emerald'))).toBe(true);
  });

  it('keeps submit disabled for a long but denylisted password', () => {
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newcomer' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1234' } });

    const submit = screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('keeps submit disabled when the password contains the email local part', () => {
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'someone' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-new-kind-of-passphrase' } });

    const submit = screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('sends the token from the URL with a normalised username', async () => {
    acceptInviteMock.mockResolvedValue({ status: 'ok', user: {}, csrfToken: 'token' });
    refreshMock.mockResolvedValue({ authenticated: true, mode: 'local' });

    renderRegister('/register?token=invite-token');
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(acceptInviteMock).toHaveBeenCalledWith({
        token: 'invite-token',
        email: 'new@example.com',
        username: 'newcomer',
        password: 'a much longer passphrase',
      })
    );
  });

  it('shows the server’s single generic message for a bad invite', async () => {
    acceptInviteMock.mockRejectedValue(
      new ApiError('This invite link is invalid or has expired.', 400, 'invite_invalid')
    );

    renderRegister();
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText('This invite link is invalid or has expired.')
    ).toBeTruthy();
  });

  it('surfaces a password-policy rejection from the server', async () => {
    acceptInviteMock.mockRejectedValue(
      new ApiError('Password must not contain your email address.', 400, 'password_policy')
    );

    renderRegister();
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText('Password must not contain your email address.')
    ).toBeTruthy();
  });
});
