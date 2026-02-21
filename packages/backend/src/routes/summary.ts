import { Router } from 'express';
import { z } from 'zod';
import { getWeeklySummary, getWeekDateRange } from '../services/summaryService.js';
import { applyRounding } from '../services/roundingService.js';
import { toISOWeek } from '@time-keeper/shared';

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
