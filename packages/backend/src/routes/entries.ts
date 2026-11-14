import { Router } from 'express';
import { z } from 'zod';
import { eq, and, gte, lt, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries } from '../db/schema.js';
import {
  isoWeekBounds,
  toDateString,
  localDayKey,
  localDayBounds,
  addDaysToDayKey,
} from '@time-keeper/shared';
import { createError } from '../middleware/errorHandler.js';
import { assertOwnedCategory } from '../services/categoryService.js';
import { getUserTimeZone } from '../services/summaryService.js';
import { createEntrySchema, updateEntrySchema, assertEntryRange } from '../utils/entryValidation.js';

export const entriesRouter = Router();

/**
 * ISO-8601 week key, e.g. `2026-W07`. `isoWeekBounds()` parses the two halves
 * with `parseInt`, so an unvalidated `?week=` can reach it as `NaN` and throw
 * (finding L-2). Validate the shape first so garbage is a 400, not a 500.
 */
const isoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

entriesRouter.get('/', (req, res, next) => {
  try {
    const query = z
      .object({ date: isoDateSchema.optional(), week: isoWeekSchema.optional() })
      .parse(req.query);
    const week = query.week;
    const timeZone = getUserTimeZone(req.userId);

    let startStr: string;
    let endStr: string;

    if (week) {
      // Monday..Sunday as local calendar days (finding H-3).
      const mondayKey = toDateString(isoWeekBounds(week).start);
      const sundayKey = addDaysToDayKey(mondayKey, 6);
      startStr = localDayBounds(mondayKey, timeZone).start.toISOString();
      endStr = localDayBounds(sundayKey, timeZone).endExclusive.toISOString();
    } else {
      const dateStr =
        query.date ?? localDayKey(new Date().toISOString(), timeZone);
      const bounds = localDayBounds(dateStr, timeZone);
      startStr = bounds.start.toISOString();
      endStr = bounds.endExclusive.toISOString();
    }

    const rows = db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, req.userId),
          gte(timeEntries.startTime, startStr),
          lt(timeEntries.startTime, endStr)
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
