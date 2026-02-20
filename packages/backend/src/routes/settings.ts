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
      .values({ userId, weeklyGoalHours: 40 })
      .returning()
      .get();
  }
  return row;
}

settingsRouter.get('/', (req, res, next) => {
  try {
    const settings = getOrCreateSettings(req.userId);
    res.json({ weeklyGoalHours: settings.weeklyGoalHours });
  } catch (err) {
    next(err);
  }
});

settingsRouter.put('/', (req, res, next) => {
  try {
    const { weeklyGoalHours } = z
      .object({ weeklyGoalHours: z.number().int().min(0).max(40) })
      .parse(req.body);

    const now = new Date().toISOString();
    db.insert(userSettings)
      .values({ userId: req.userId, weeklyGoalHours, updatedAt: now })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { weeklyGoalHours, updatedAt: now },
      })
      .run();

    res.json({ weeklyGoalHours });
  } catch (err) {
    next(err);
  }
});
