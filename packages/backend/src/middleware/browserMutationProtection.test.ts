import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { protectBrowserMutations } from './browserMutationProtection.js';

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: { host: 'timekeeper.example.com' },
    method: 'POST',
    authMethod: 'header',
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

describe('protectBrowserMutations', () => {
  it('allows safe methods for header-authenticated requests', () => {
    const req = makeRequest({ method: 'GET' });
    const res = makeResponse();
    const next = makeNext();

    protectBrowserMutations(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('allows token-authenticated mutation requests without origin checks', () => {
    const req = makeRequest({ authMethod: 'token' as const, headers: { host: 'api.example.com' } });
    const res = makeResponse();
    const next = makeNext();

    protectBrowserMutations(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('allows same-origin browser mutation requests using Origin', () => {
    const req = makeRequest({ headers: { host: 'timekeeper.example.com', origin: 'https://timekeeper.example.com' } });
    const res = makeResponse();
    const next = makeNext();

    protectBrowserMutations(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('allows same-origin browser mutation requests using Referer when Origin is absent', () => {
    const req = makeRequest({ headers: { host: 'timekeeper.example.com', referer: 'https://timekeeper.example.com/settings' } });
    const res = makeResponse();
    const next = makeNext();

    protectBrowserMutations(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('blocks browser mutation requests with a foreign Origin', () => {
    const req = makeRequest({ headers: { host: 'timekeeper.example.com', origin: 'https://attacker.example.com' } });
    const res = makeResponse();
    const next = makeNext();

    protectBrowserMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Cross-site browser request blocked' });
  });

  it('blocks browser mutation requests when neither Origin nor Referer is present', () => {
    const req = makeRequest({ headers: { host: 'timekeeper.example.com' } });
    const res = makeResponse();
    const next = makeNext();

    protectBrowserMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Cross-site browser request blocked' });
  });
});
