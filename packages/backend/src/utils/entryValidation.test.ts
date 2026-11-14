import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEntrySchema, updateEntrySchema } from './entryValidation.js';
import { errorHandler } from '../middleware/errorHandler.js';

describe('entry schemas on zod 4', () => {
  it('parses valid completed-entry payloads', () => {
    const result = createEntrySchema.safeParse({
      categoryId: 1,
      startTime: '2026-05-13T09:00:00.000Z',
      endTime: '2026-05-13T10:00:00.000Z',
      notes: 'Backfilled work',
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid payloads with a ZodError carrying issue paths', () => {
    const result = createEntrySchema.safeParse({
      categoryId: -1,
      startTime: 'not-a-date',
      endTime: '2026-05-13T10:00:00.000Z',
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error).toBeInstanceOf(z.ZodError);
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['categoryId', 'startTime'])
    );
  });

  it('rejects endTime:null on update so a completed entry cannot be reopened (P2-1)', () => {
    const result = updateEntrySchema.safeParse({ endTime: null });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('endTime');
  });

  it('routes a ZodError to errorHandler as a 400 with path/message issues (P1-3)', () => {
    const parsed = createEntrySchema.safeParse({});
    if (parsed.success) throw new Error('expected the empty payload to be rejected');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const json = vi.fn();
    const req = {} as Parameters<typeof errorHandler>[1];
    const res = { status: vi.fn(() => ({ json })) } as unknown as Parameters<typeof errorHandler>[2];

    errorHandler(parsed.error, req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0]?.[0] as {
      error: string;
      issues: Array<{ path: string; message: string }>;
    };
    expect(body.error).toBe('Validation failed');
    expect(body.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['categoryId', 'startTime', 'endTime'])
    );
    // The response carries only path/message — never the offending input.
    for (const issue of body.issues) {
      expect(Object.keys(issue).sort()).toEqual(['message', 'path']);
    }
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
