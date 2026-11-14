import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthGate } from '../AuthGate';

/**
 * The gate is deliberately thin: it chooses between the app, the local login
 * page and (proxy mode only) the pre-Phase-B reload overlay. These tests pin
 * that decision table.
 */
const { state } = vi.hoisted(() => ({
  state: {
    loading: false,
    user: null as null | { email: string },
    mode: 'local' as 'local' | 'proxy' | 'hybrid' | null,
    sessionExpired: false,
  },
}));

vi.mock('@/lib/authContext', () => ({
  useAuthContext: () => state,
}));

vi.mock('@/pages/Login', () => ({
  Login: () => <div>LOGIN PAGE</div>,
}));

vi.mock('@/components/SessionExpiredOverlay', () => ({
  SessionExpiredOverlay: () => <div>SESSION OVERLAY</div>,
}));

describe('AuthGate', () => {
  it('shows a quiet loading state while status resolves', () => {
    state.loading = true;
    state.user = null;
    state.sessionExpired = false;

    render(<AuthGate><div>APP</div></AuthGate>);

    expect(screen.getByText('Checking your session…')).toBeTruthy();
  });

  it('renders the app when a user is present', () => {
    state.loading = false;
    state.user = { email: 'alice@example.com' };
    state.sessionExpired = false;

    render(<AuthGate><div>APP</div></AuthGate>);

    expect(screen.getByText('APP')).toBeTruthy();
  });

  it('replaces a stale app with the login page after a 401', () => {
    state.loading = false;
    state.user = { email: 'alice@example.com' };
    state.mode = 'local';
    state.sessionExpired = true;

    render(<AuthGate><div>APP</div></AuthGate>);

    expect(screen.getByText('LOGIN PAGE')).toBeTruthy();
  });

  it('renders the local login page when unauthenticated in local mode', () => {
    state.loading = false;
    state.user = null;
    state.mode = 'local';
    state.sessionExpired = false;

    render(<AuthGate><div>APP</div></AuthGate>);

    expect(screen.getByText('LOGIN PAGE')).toBeTruthy();
  });

  it('renders the reload overlay — not a local form — in proxy mode', () => {
    state.loading = false;
    state.user = null;
    state.mode = 'proxy';
    state.sessionExpired = false;

    render(<AuthGate><div>APP</div></AuthGate>);

    expect(screen.getByText('SESSION OVERLAY')).toBeTruthy();
  });

  it('falls back to the reload overlay when the status call itself failed', () => {
    state.loading = false;
    state.user = null;
    state.mode = null;
    state.sessionExpired = false;

    render(<AuthGate><div>APP</div></AuthGate>);

    expect(screen.getByText('SESSION OVERLAY')).toBeTruthy();
  });
});
