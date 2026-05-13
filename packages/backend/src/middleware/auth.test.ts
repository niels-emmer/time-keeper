import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mockGet = vi.fn();
const mockRun = vi.fn();

vi.mock('../db/client.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ get: mockGet }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ run: mockRun }),
      }),
    }),
  },
}));

vi.mock('../db/schema.js', () => ({
  apiTokens: {
    tokenHash: 'token_hash',
    id: 'id',
  },
}));

const originalEnv = { ...process.env };

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    method: 'GET',
    ...overrides,
  } as Request;
}

function makeResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  return res as Response & { statusCode: number; body: unknown };
}

function makeNext(): ReturnType<typeof vi.fn> & NextFunction {
  return vi.fn() as ReturnType<typeof vi.fn> & NextFunction;
}

describe('authMiddleware', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.INTERNAL_PROXY_SECRET;
    delete process.env.DEV_USER_ID;
    process.env.NODE_ENV = 'production';
    mockGet.mockReset();
    mockRun.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects header auth in production when INTERNAL_PROXY_SECRET is missing', async () => {
    const { authMiddleware } = await import('./auth.js');
    const req = makeRequest({ headers: { 'x-authentik-email': 'alice@example.com' } });
    const res = makeResponse();
    const next = makeNext();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects header auth in production when X-Internal-Token does not match', async () => {
    const { authMiddleware } = await import('./auth.js');
    process.env.INTERNAL_PROXY_SECRET = 'expected-secret';

    const req = makeRequest({
      headers: {
        'x-authentik-email': 'alice@example.com',
        'x-internal-token': 'wrong-secret',
      },
    });
    const res = makeResponse();
    const next = makeNext();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('accepts header auth in production when X-Internal-Token matches', async () => {
    const { authMiddleware } = await import('./auth.js');
    process.env.INTERNAL_PROXY_SECRET = 'expected-secret';

    const req = makeRequest({
      headers: {
        'x-authentik-email': 'alice@example.com',
        'x-internal-token': 'expected-secret',
      },
    });
    const res = makeResponse();
    const next = makeNext();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe('alice@example.com');
    expect(req.authMethod).toBe('header');
    expect(res.statusCode).toBe(200);
  });

  it('keeps DEV_USER_ID fallback available outside production', async () => {
    const { authMiddleware } = await import('./auth.js');
    process.env.NODE_ENV = 'development';
    process.env.DEV_USER_ID = 'dev@example.com';

    const req = makeRequest();
    const res = makeResponse();
    const next = makeNext();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe('dev@example.com');
    expect(req.authMethod).toBe('header');
  });

  it('does not fall through to header auth when a bearer token is invalid', async () => {
    const { authMiddleware } = await import('./auth.js');
    process.env.INTERNAL_PROXY_SECRET = 'expected-secret';
    mockGet.mockReturnValue(undefined);

    const req = makeRequest({
      headers: {
        authorization: 'Bearer invalid-token',
        'x-authentik-email': 'alice@example.com',
        'x-internal-token': 'expected-secret',
      },
    });
    const res = makeResponse();
    const next = makeNext();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects expired bearer tokens', async () => {
    const { authMiddleware } = await import('./auth.js');
    mockGet.mockReturnValue({
      id: 1,
      userId: 'alice@example.com',
      expiresAt: '2026-05-12T12:00:00.000Z',
    });

    const req = makeRequest({
      headers: {
        authorization: 'Bearer expired-token',
      },
    });
    const res = makeResponse();
    const next = makeNext();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('allows requireHeaderAuth only for browser-authenticated requests', async () => {
    const { requireHeaderAuth } = await import('./auth.js');
    const headerReq = makeRequest({ authMethod: 'header' as const });
    const tokenReq = makeRequest({ authMethod: 'token' as const });
    const next = makeNext();

    requireHeaderAuth(headerReq, makeResponse(), next);
    expect(next).toHaveBeenCalledOnce();

    const res = makeResponse();
    requireHeaderAuth(tokenReq, res, makeNext());
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Token management requires interactive (browser) authentication' });
  });
});
