import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  AuthError,
  ForbiddenError,
  api,
  getErrorMessage,
  normalizeServerMessage,
} from '@/lib/api';

/**
 * The empty-alert regression: an error whose message is blank (or not a string
 * at all) must still produce copy a person can read and act on.
 */
describe('normalizeServerMessage', () => {
  it('accepts only a non-blank string', () => {
    expect(normalizeServerMessage('That code is not valid.')).toBe('That code is not valid.');
    expect(normalizeServerMessage('  padded  ')).toBe('padded');
  });

  it('rejects the shapes an API body can carry when there is no usable error', () => {
    expect(normalizeServerMessage(undefined)).toBeUndefined();
    expect(normalizeServerMessage(null)).toBeUndefined();
    expect(normalizeServerMessage('')).toBeUndefined();
    expect(normalizeServerMessage('   ')).toBeUndefined();
    expect(normalizeServerMessage(42)).toBeUndefined();
    expect(normalizeServerMessage({ message: 'nested' })).toBeUndefined();
    expect(normalizeServerMessage(['Validation failed'])).toBeUndefined();
  });
});

describe('getErrorMessage', () => {
  it('never returns an empty string', () => {
    const cases: unknown[] = [
      new ApiError('', 400),
      new ApiError('   ', 400),
      new ForbiddenError(''),
      new AuthError(401),
      new Error(''),
      {},
      undefined,
      null,
    ];

    for (const error of cases) {
      const message = getErrorMessage(error);
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  it('prefers the server message when it is usable', () => {
    expect(getErrorMessage(new ApiError('An account with that email already exists.', 409))).toBe(
      'An account with that email already exists.'
    );
  });

  it('falls back to the caller message when the server sent nothing', () => {
    expect(getErrorMessage(new ApiError('', 400), 'Could not confirm that code.')).toBe(
      'Could not confirm that code.'
    );
  });

  it('falls back to generic copy when even the caller fallback is blank', () => {
    expect(getErrorMessage(new ApiError('', 400), '   ')).toBe(
      'Something went wrong. Please try again.'
    );
  });

  it('maps MFA codes to safe, specific copy', () => {
    expect(getErrorMessage(new ApiError('', 400, 'mfa_code_invalid'))).toMatch(
      /That code is not valid.*change every 30 seconds/i
    );
    expect(getErrorMessage(new AuthError(401, 'mfa_code_replayed'))).toMatch(/already been used/i);
    expect(getErrorMessage(new ApiError('', 400, 'mfa_enrolment_not_started'))).toMatch(
      /Setup needs restarting/i
    );
  });

  it('maps the freshness and API-token answers a 403 can carry', () => {
    expect(getErrorMessage(new ForbiddenError('', 'reauthentication_required'))).toMatch(
      /fresh sign-in/i
    );
    expect(
      getErrorMessage(new ForbiddenError('', 'interactive_authentication_required'))
    ).toMatch(/browser sign-in/i);
  });

  it('treats a bare 401 as an expired session', () => {
    expect(getErrorMessage(new AuthError(401))).toMatch(/session has expired/i);
  });
});

/**
 * `request()` must turn every non-2xx answer into an error whose message is
 * usable, including the bodies that carry no `error` field at all.
 */
describe('request() error normalisation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respondWith(body: string, status: number, contentType = 'application/json') {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, { status, headers: { 'content-type': contentType } })
      )
    );
  }

  it('replaces a plain-text 429 (the rate limiter) with readable copy', async () => {
    respondWith('Too many requests, please try again later.', 429, 'text/plain');

    const error = await api.auth.confirmMfa('123456').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(getErrorMessage(error)).toMatch(/Too many requests/i);
    expect(getErrorMessage(error)).not.toBe('HTTP 429');
  });

  it('never surfaces an empty message when the body is only `issues`', async () => {
    respondWith(JSON.stringify({ error: 'Validation failed', issues: [] }), 400);

    const error = await api.auth.confirmMfa('123456').catch((caught: unknown) => caught);

    expect(getErrorMessage(error)).toBe('Validation failed');
  });

  it('gives a generic line when the body is JSON without an error field', async () => {
    respondWith(JSON.stringify({ ok: false }), 400);

    const error = await api.auth.confirmMfa('123456').catch((caught: unknown) => caught);

    expect(getErrorMessage(error).trim().length).toBeGreaterThan(0);
    expect(getErrorMessage(error)).toMatch(/not valid/i);
  });

  it('carries the machine-readable code on a 401 so a code failure is not a session loss', async () => {
    respondWith(
      JSON.stringify({ error: 'That code is not valid.', code: 'mfa_code_replayed' }),
      401
    );

    const error = await api.auth.loginMfa('alice', 'password', '123456').catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe('mfa_code_replayed');
    expect(getErrorMessage(error)).toMatch(/already been used/i);
  });
});
