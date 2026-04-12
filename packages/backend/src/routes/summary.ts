import { Router } from 'express';
import { z } from 'zod';
import { eq, and, gte, lte, isNotNull, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries, categories } from '../db/schema.js';
import { getWeeklySummary, getWeekDateRange } from '../services/summaryService.js';
import { applyRounding } from '../services/roundingService.js';
import { toISOWeek } from '@time-keeper/shared';
import { createError } from '../middleware/errorHandler.js';

export const summaryRouter = Router();

summaryRouter.get('/weekly', (req, res, next) => {
  try {
    const week =
      (req.query.week as string | undefined) ?? toISOWeek(new Date());
    const summary = getWeeklySummary(req.userId, week);
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
    const { week } = z
      .object({ week: z.string().regex(/^\d{4}-W\d{2}$/) })
      .parse(req.body);

    const { dates } = getWeekDateRange(week);
    const results = dates.map((date) => applyRounding(req.userId, date));
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

    // Verify category belongs to this user
    const cat = db.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, req.userId)))
      .get();
    if (!cat) throw createError('Category not found', 404);

    const startOfDay = `${date}T00:00:00.000Z`;
    const endOfDay   = `${date}T23:59:59.999Z`;
    const now = new Date().toISOString();

    const existing = db.select().from(timeEntries)
      .where(and(
        eq(timeEntries.userId, req.userId),
        eq(timeEntries.categoryId, categoryId),
        isNotNull(timeEntries.endTime),
        gte(timeEntries.startTime, startOfDay),
        lte(timeEntries.startTime, endOfDay),
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
      const startTime = `${date}T09:00:00.000Z`;
      const endTime   = new Date(new Date(startTime).getTime() + minutes * 60000).toISOString();
      db.insert(timeEntries).values({
        userId: req.userId, categoryId, startTime, endTime,
        rounded: false, createdAt: now, updatedAt: now,
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
        .set({ endTime: newEndTime, updatedAt: now })
        .where(and(eq(timeEntries.id, lastEntry.id), eq(timeEntries.userId, req.userId)))
        .run();
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
