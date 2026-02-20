import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { userSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const settingsRouter = Router();

function getOrCreateSettings(userId: string) {
  let row = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
  if (!row) {
    row = db
      .insert(userSettings)
      .values({ userId, weeklyGoalHours: 40, roundingIncrementMinutes: 60 })
      .returning()
      .get();
  }
  return row;
}

settingsRouter.get('/', (req, res, next) => {
  try {
    const settings = getOrCreateSettings(req.userId);
    res.json({
      weeklyGoalHours: settings.weeklyGoalHours,
      roundingIncrementMinutes: settings.roundingIncrementMinutes,
    });
  } catch (err) {
    next(err);
  }
});

settingsRouter.put('/', (req, res, next) => {
  try {
    const { weeklyGoalHours, roundingIncrementMinutes } = z
      .object({
        weeklyGoalHours: z.number().int().min(0).max(40),
        roundingIncrementMinutes: z.union([z.literal(30), z.literal(60)]),
      })
      .parse(req.body);

    const now = new Date().toISOString();
    db.insert(userSettings)
      .values({ userId: req.userId, weeklyGoalHours, roundingIncrementMinutes, updatedAt: now })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { weeklyGoalHours, roundingIncrementMinutes, updatedAt: now },
      })
      .run();

    res.json({ weeklyGoalHours, roundingIncrementMinutes });
  } catch (err) {
    next(err);
  }
});
