import { Router } from 'express';
import { z } from 'zod';
import { eq, and, gte, lte, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries } from '../db/schema.js';
import { isoWeekBounds } from '@time-keeper/shared';
import { createError } from '../middleware/errorHandler.js';
import { assertOwnedCategory } from '../services/categoryService.js';
import { createEntrySchema, updateEntrySchema, assertEntryRange } from '../utils/entryValidation.js';

export const entriesRouter = Router();

/**
 * ISO-8601 week key, e.g. `2026-W07`. `isoWeekBounds()` parses the two halves
 * with `parseInt`, so an unvalidated `?week=` can reach it as `NaN` and throw
 * (finding L-2). Validate the shape first so garbage is a 400, not a 500.
 */
const isoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/);

entriesRouter.get('/', (req, res, next) => {
  try {
    const { date } = req.query;
    const week = z.object({ week: isoWeekSchema.optional() }).parse(req.query).week;

    let startStr: string;
    let endStr: string;

    if (week) {
      const bounds = isoWeekBounds(week);
      startStr = bounds.start.toISOString();
      endStr = new Date(bounds.end.getTime() + 86_399_999).toISOString();
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
      .orderBy(asc(timeEntries.startTime))
      .all();

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

entriesRouter.post('/', (req, res, next) => {
  try {
    const body = createEntrySchema.parse(req.body);
    assertOwnedCategory(req.userId, body.categoryId);
    assertEntryRange(body.startTime, body.endTime);

    const now = new Date().toISOString();

    const result = db
      .insert(timeEntries)
      .values({
        userId: req.userId,
        categoryId: body.categoryId,
        startTime: body.startTime,
        endTime: body.endTime,
        notes: body.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

entriesRouter.patch('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw createError('Invalid id', 400);

    const body = updateEntrySchema.parse(req.body);

    const existing = db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, req.userId)))
      .get();

    if (!existing) throw createError('Entry not found', 404);

    if (body.categoryId !== undefined) {
      assertOwnedCategory(req.userId, body.categoryId);
    }

    const nextStartTime = body.startTime ?? existing.startTime;
    const nextEndTime = body.endTime !== undefined ? body.endTime : existing.endTime;
    assertEntryRange(nextStartTime, nextEndTime);

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
    if (Number.isNaN(id)) throw createError('Invalid id', 400);

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
