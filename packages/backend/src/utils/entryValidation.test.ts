import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEntrySchema } from './entryValidation.js';
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

  it('keeps routing a ZodError to errorHandler as an unexpected 500 (pre-P1-3 behavior)', () => {
    const parsed = createEntrySchema.safeParse({});
    if (parsed.success) throw new Error('expected the empty payload to be rejected');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const json = vi.fn();
    const req = {} as Parameters<typeof errorHandler>[1];
    const res = { status: vi.fn(() => ({ json })) } as unknown as Parameters<typeof errorHandler>[2];

    errorHandler(parsed.error, req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error' });
    errorSpy.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
