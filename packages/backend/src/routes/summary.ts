import { Router } from 'express';
import { z } from 'zod';
import { eq, and, gte, lt, isNotNull, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries } from '../db/schema.js';
import { getWeeklySummary, getMonthlySummary, getWeekDateRange, getUserTimeZone } from '../services/summaryService.js';
import { applyRounding } from '../services/roundingService.js';
import { assertOwnedCategory } from '../services/categoryService.js';
import { localDayBounds, toISOWeek } from '@time-keeper/shared';

export const summaryRouter = Router();

/**
 * ISO-8601 week key, e.g. `2026-W07`.
 *
 * `isoWeekBounds()` in `@time-keeper/shared` splits on `-W` and `parseInt`s the
 * parts, so arbitrary strings can produce Invalid Date / RangeError and turn a
 * bad query parameter into a 500. Validating the shape first (finding L-2)
 * makes garbage a 400 via the error handler instead.
 */
const isoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/);

/**
 * Calendar month key, `YYYY-MM` with a real 01–12 month (finding L-3).
 */
const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .refine((value) => {
    const month = Number(value.slice(5, 7));
    return month >= 1 && month <= 12;
  }, { message: 'Month must be between 01 and 12' });

summaryRouter.get('/weekly', (req, res, next) => {
  try {
    const week =
      z.object({ week: isoWeekSchema.optional() }).parse(req.query).week ??
      toISOWeek(new Date());
    const summary = getWeeklySummary(req.userId, week);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

summaryRouter.get('/monthly', (req, res, next) => {
  try {
    const month =
      z.object({ month: monthSchema.optional() }).parse(req.query).month ??
      new Date().toISOString().slice(0, 7);

    const summary = getMonthlySummary(req.userId, month);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

summaryRouter.post('/round', (req, res, next) => {
  try {
    const { date } = z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .parse(req.body);

    const result = applyRounding(req.userId, date);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

summaryRouter.post('/round-week', (req, res, next) => {
  try {
    const { week } = z.object({ week: isoWeekSchema }).parse(req.body);

    const { dates } = getWeekDateRange(week);
    // One outer transaction: a failure on any day rolls the whole week back
    // instead of leaving earlier days committed (finding M-9).
    const results = db.transaction(() => dates.map((date) => applyRounding(req.userId, date)));
    res.json({ week, results });
  } catch (err) {
    next(err);
  }
});

const adjustCellSchema = z.object({
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.number().int().positive(),
  minutes:    z.number().int().min(0),
});

summaryRouter.patch('/adjust-cell', (req, res, next) => {
  try {
    const { date, categoryId, minutes } = adjustCellSchema.parse(req.body);

    assertOwnedCategory(req.userId, categoryId, 404);

    // Local-day window (H-3 follow-up): the Weekly summary edits a local day,
    // so adjust-cell must find the same entries.
    const timeZone = getUserTimeZone(req.userId);
    const dayBounds = localDayBounds(date, timeZone);
    const startOfDay = dayBounds.start.toISOString();
    const endOfDay = dayBounds.endExclusive.toISOString();
    const now = new Date().toISOString();

    const existing = db.select().from(timeEntries)
      .where(and(
        eq(timeEntries.userId, req.userId),
        eq(timeEntries.categoryId, categoryId),
        isNotNull(timeEntries.endTime),
        gte(timeEntries.startTime, startOfDay),
        lt(timeEntries.startTime, endOfDay),
      ))
      .orderBy(asc(timeEntries.startTime))
      .all();

    if (minutes === 0) {
      for (const e of existing) {
        db.delete(timeEntries)
          .where(and(eq(timeEntries.id, e.id), eq(timeEntries.userId, req.userId)))
          .run();
      }
    } else if (existing.length === 0) {
      // 09:00 inside the user's local day, not 09:00 UTC.
      const startTime = new Date(dayBounds.start.getTime() + 9 * 60 * 60 * 1000).toISOString();
      const endTime   = new Date(new Date(startTime).getTime() + minutes * 60000).toISOString();
      db.insert(timeEntries).values({
        userId: req.userId, categoryId, startTime, endTime,
        // The user typed this value: never re-round it (finding M-9).
        rounded: true, createdAt: now, updatedAt: now,
      }).run();
    } else {
      const allButLast    = existing.slice(0, -1);
      const lastEntry     = existing[existing.length - 1];
      const sumExceptLast = allButLast.reduce((sum, e) => {
        return sum + Math.floor((new Date(e.endTime!).getTime() - new Date(e.startTime).getTime()) / 60000);
      }, 0);
      const desiredLastMin = Math.max(0, minutes - sumExceptLast);
      const newEndTime = new Date(
        new Date(lastEntry.startTime).getTime() + desiredLastMin * 60000
      ).toISOString();
      db.update(timeEntries)
        // The typed value is authoritative: mark it rounded so "Round week"
        // does not silently change it (finding M-9).
        .set({ endTime: newEndTime, rounded: true, updatedAt: now })
        .where(and(eq(timeEntries.id, lastEntry.id), eq(timeEntries.userId, req.userId)))
        .run();

      // The cell total is what the user typed, so freeze the category's other
      // entries for the day as well — otherwise rounding could still shift
      // the cell total through them.
      for (const entry of existing) {
        if (entry.id === lastEntry.id) continue;
        db.update(timeEntries)
          .set({ rounded: true, updatedAt: now })
          .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.userId, req.userId)))
          .run();
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
