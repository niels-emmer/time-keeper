import { Router } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { timeEntries } from '../db/schema.js';
import { isoWeekBounds } from '@time-keeper/shared';
import { createError } from '../middleware/errorHandler.js';

export const entriesRouter = Router();

const updateSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
});

entriesRouter.get('/', (req, res, next) => {
  try {
    const { date, week } = req.query;

    let startStr: string;
    let endStr: string;

    if (week && typeof week === 'string') {
      const bounds = isoWeekBounds(week);
      startStr = bounds.start.toISOString();
      endStr = new Date(bounds.end.getTime() + 86399999).toISOString();
    } else {
      const dateStr = (date as string | undefined) ?? new Date().toISOString().slice(0, 10);
      startStr = `${dateStr}T00:00:00.000Z`;
      endStr = `${dateStr}T23:59:59.999Z`;
    }

    const rows = db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, req.userId),
          gte(timeEntries.startTime, startStr),
          lte(timeEntries.startTime, endStr)
        )
      )
      .all();

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

entriesRouter.patch('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw createError('Invalid id', 400);

    const body = updateSchema.parse(req.body);
    const now = new Date().toISOString();

    const result = db
      .update(timeEntries)
      .set({ ...body, updatedAt: now })
      .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, req.userId)))
      .returning()
      .get();

    if (!result) throw createError('Entry not found', 404);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

entriesRouter.delete('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw createError('Invalid id', 400);

    const result = db
      .delete(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, req.userId)))
      .returning()
      .get();

    if (!result) throw createError('Entry not found', 404);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
