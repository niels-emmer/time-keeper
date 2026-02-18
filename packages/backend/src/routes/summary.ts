import { Router } from 'express';
import { z } from 'zod';
import { getWeeklySummary } from '../services/summaryService.js';
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
