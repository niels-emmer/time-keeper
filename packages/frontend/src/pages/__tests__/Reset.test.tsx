import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { Reset } from '../Reset';

const { resetPasswordMock } = vi.hoisted(() => ({
  resetPasswordMock: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, resetPassword: resetPasswordMock },
    },
  };
});

function renderReset(path = '/reset?code=reset-code') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset" element={<Reset />} />
        <Route path="/" element={<div>SIGN IN</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function fillPasswords(password = 'a properly long passphrase') {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: password },
  });
}

describe('Reset', () => {
  beforeEach(() => {
    resetPasswordMock.mockReset();
  });

  it('takes the code from the URL and keeps submit disabled until the policy is met', () => {
    renderReset('/reset?code=from-the-link');

    const code = screen.getByLabelText('Reset code') as HTMLInputElement;
    expect(code.value).toBe('from-the-link');

    const submit = screen.getByRole('button', { name: /set password/i }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'short' },
    });
    expect(submit.disabled).toBe(true);

    fillPasswords();
    expect(submit.disabled).toBe(false);
  });

  it('also accepts a code typed into the field (no link)', async () => {
    resetPasswordMock.mockResolvedValue(undefined);

    renderReset('/reset');
    fireEvent.change(screen.getByLabelText('Reset code'), {
      target: { value: 'typed-code' },
    });
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() =>
      expect(resetPasswordMock).toHaveBeenCalledWith({
        code: 'typed-code',
        newPassword: 'a properly long passphrase',
      })
    );
  });

  it('shows a success state and offers the sign-in route', async () => {
    resetPasswordMock.mockResolvedValue(undefined);

    renderReset();
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Password set')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /go to sign in/i }));
    expect(await screen.findByText('SIGN IN')).toBeTruthy();
  });

  it('surfaces the single generic message for an invalid or expired code', async () => {
    resetPasswordMock.mockRejectedValue(
      new ApiError('This reset code is invalid or has expired.', 400, 'reset_code_invalid')
    );

    renderReset();
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    expect(
      await screen.findByText('This reset code is invalid or has expired.')
    ).toBeTruthy();
  });

  it('surfaces a server-side password-policy rejection', async () => {
    resetPasswordMock.mockRejectedValue(
      new ApiError('Password must not contain your username.', 400, 'password_policy')
    );

    renderReset();
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Password must not contain your username.')).toBeTruthy();
  });
});
