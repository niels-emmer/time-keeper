import { Router } from 'express';
import { z } from 'zod';
import { getActiveTimer, startTimer, stopTimer } from '../services/timerService.js';

export const timerRouter = Router();

timerRouter.get('/', (req, res, next) => {
  try {
    const active = getActiveTimer(req.userId);
    if (active) {
      res.json({ active: true, entry: active });
    } else {
      res.json({ active: false });
    }
  } catch (err) {
    next(err);
  }
});

timerRouter.post('/start', (req, res, next) => {
  try {
    const { categoryId } = z.object({ categoryId: z.number().int().positive() }).parse(req.body);
    const entry = startTimer(req.userId, categoryId);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

timerRouter.post('/stop', (req, res, next) => {
  try {
    const entry = stopTimer(req.userId);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});
