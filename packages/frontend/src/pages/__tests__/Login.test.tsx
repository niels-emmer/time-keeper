import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@/lib/api';
import { Login } from '../Login';

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }));

vi.mock('@/lib/authContext', () => ({
  useAuthContext: () => ({ login: loginMock }),
}));

function fillAndSubmit(identifier = 'alice', password = 'correct horse') {
  render(<Login />);
  fireEvent.change(screen.getByLabelText('Username or email'), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('Login', () => {
  beforeEach(() => {
    loginMock.mockReset();
  });

  it('submits the username/email and password in one step', async () => {
    loginMock.mockResolvedValue({ status: 'ok', user: {}, csrfToken: 'token' });

    fillAndSubmit('alice@example.com', 'correct horse');

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith('alice@example.com', 'correct horse')
    );
  });

  it('shows the single generic message on 401, leaking nothing', async () => {
    loginMock.mockRejectedValue(new AuthError(401));

    fillAndSubmit('alice', 'wrong');

    expect(await screen.findByText('Invalid username or password.')).toBeTruthy();
  });

  it('shows a lockout/server message verbatim', async () => {
    loginMock.mockRejectedValue(new Error('Too many attempts. Try again later.'));

    fillAndSubmit('alice', 'wrong');

    expect(await screen.findByText('Too many attempts. Try again later.')).toBeTruthy();
  });

  it('reports the MFA challenge state without pretending a session exists', async () => {
    loginMock.mockResolvedValue({ status: 'mfa_required' });

    fillAndSubmit('alice', 'correct horse');

    expect(
      await screen.findByText(/Two-factor authentication is required/i)
    ).toBeTruthy();
  });

  it('keeps submit disabled until both fields are filled', () => {
    render(<Login />);

    const button = screen.getByRole('button', { name: /sign in/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Username or email'), {
      target: { value: 'alice' },
    });
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse' },
    });
    expect(button.disabled).toBe(false);
  });
});
