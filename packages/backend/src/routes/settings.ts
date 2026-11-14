import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { userSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@time-keeper/shared';

export const settingsRouter = Router();

const timeZoneSchema = z.string().refine(isValidTimeZone, {
  message: 'Must be a valid IANA time zone (e.g. Europe/Amsterdam)',
});

function getOrCreateSettings(userId: string) {
  let row = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
  if (!row) {
    row = db
      .insert(userSettings)
      .values({ userId, weeklyGoalHours: 40, roundingIncrementMinutes: 60, timezone: DEFAULT_TIME_ZONE })
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
      timezone: settings.timezone,
    });
  } catch (err) {
    next(err);
  }
});

settingsRouter.put('/', (req, res, next) => {
  try {
    const { weeklyGoalHours, roundingIncrementMinutes, timezone } = z
      .object({
        weeklyGoalHours: z.number().int().min(0).max(40),
        roundingIncrementMinutes: z.union([z.literal(30), z.literal(60)]),
        timezone: timeZoneSchema.optional(),
      })
      .parse(req.body);

    const current = getOrCreateSettings(req.userId);
    const nextTimeZone = timezone ?? current.timezone ?? DEFAULT_TIME_ZONE;
    const now = new Date().toISOString();
    db.insert(userSettings)
      .values({ userId: req.userId, weeklyGoalHours, roundingIncrementMinutes, timezone: nextTimeZone, updatedAt: now })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { weeklyGoalHours, roundingIncrementMinutes, timezone: nextTimeZone, updatedAt: now },
      })
      .run();

    res.json({ weeklyGoalHours, roundingIncrementMinutes, timezone: nextTimeZone });
  } catch (err) {
    next(err);
  }
});
