import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@/lib/api';
import { Login } from '../Login';

const { loginMock, loginMfaMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  loginMfaMock: vi.fn(),
}));

vi.mock('@/lib/authContext', () => ({
  useAuthContext: () => ({ login: loginMock, loginMfa: loginMfaMock }),
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
    loginMfaMock.mockReset();
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

  it('moves to the second step and completes with a TOTP code', async () => {
    loginMock.mockResolvedValue({ status: 'mfa_required' });
    loginMfaMock.mockResolvedValue({ status: 'ok', user: {}, csrfToken: 'token' });

    fillAndSubmit('alice', 'correct horse');

    const codeInput = (await screen.findByLabelText('Authentication code')) as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() =>
      expect(loginMfaMock).toHaveBeenCalledWith('alice', 'correct horse', '123456')
    );
  });

  it('offers a recovery-code path that submits the same request', async () => {
    loginMock.mockResolvedValue({ status: 'mfa_required' });
    loginMfaMock.mockResolvedValue({ status: 'ok', user: {}, csrfToken: 'token' });

    fillAndSubmit('alice', 'correct horse');

    await screen.findByLabelText('Authentication code');
    fireEvent.click(screen.getByRole('button', { name: /use a recovery code/i }));

    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: 'ABCDE-FGHJK' },
    });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() =>
      expect(loginMfaMock).toHaveBeenCalledWith('alice', 'correct horse', 'ABCDE-FGHJK')
    );
  });

  it('keeps a rejected code on the second step with actionable copy', async () => {
    loginMock.mockResolvedValue({ status: 'mfa_required' });
    loginMfaMock.mockRejectedValue(new AuthError(401));

    fillAndSubmit('alice', 'correct horse');

    const codeInput = await screen.findByLabelText('Authentication code');
    fireEvent.change(codeInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    expect(
      await screen.findByText(/That code is not valid. Check your authenticator/i)
    ).toBeTruthy();
    // Still on the code step: the person can simply try the next code.
    expect(screen.getByLabelText('Authentication code')).toBeTruthy();
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
