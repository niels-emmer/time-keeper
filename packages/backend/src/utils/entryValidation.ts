import { z } from 'zod';
import { createError } from '../middleware/errorHandler.js';

export const createEntrySchema = z.object({
  categoryId: z.number().int().positive(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  notes: z.string().nullable().optional(),
});

export const updateEntrySchema = z.object({
  categoryId: z.number().int().positive().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export function assertEntryRange(startTime: string, endTime: string | null) {
  if (endTime === null) return;

  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw createError('Invalid time range', 400);
  }

  if (endMs <= startMs) {
    throw createError('End time must be after start time', 400);
  }
}
