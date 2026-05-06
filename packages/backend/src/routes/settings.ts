import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { userSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getMonthlyGoal, setMonthlyGoal } from '../utils/monthlyGoalHelper.js';

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

/**
 * GET /api/summary/monthly-goals
 * Retrieves the monthly goal allocated for the current category/project for a given month.
 * Expects query params: categoryId, monthYear (e.g., '2026-05')
 */
settingsRouter.get('/monthly-goals', async (req, res, next) => {
  try {
    const { categoryId, monthYear } = req.query;

    if (!categoryId || !monthYear) {
      return res.status(400).json({ error: 'Missing required query parameters: categoryId and monthYear (YYYY-MM) are needed.' });
    }

    const catId = parseInt(categoryId as string);
    const monthYearStr = monthYear as string;

    if (isNaN(catId)) {
        return res.status(400).json({ error: 'Invalid categoryId provided.' });
    }

    // TODO: Pass actual user ID from req.user/req.userId
    const userId = req.userId; 

    const goal = await getMonthlyGoal(userId, catId, monthYearStr);

    if (!goal) {
      return res.status(200).json({ goal: null, message: 'No monthly goal found for this criteria.' });
    }

    res.json({
      goal: goal,
      message: 'Monthly goal retrieved successfully.'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/summary/set-monthly-goal
 * Sets or overwrites the allocated monthly effort hours/minutes for a specific project.
 * Requires: { categoryId: number, monthYear: string, availableHours: number, availableMinutes: number }
 */
settingsRouter.post('/set-monthly-goal', async (req, res, next) => {
  try {
    const { categoryId, monthYear, availableHours, availableMinutes } = req.body;

    // Basic validation
    if (!categoryId || !monthYear || typeof availableHours !== 'number' || typeof availableMinutes !== 'number') {
      return res.status(400).json({ error: 'Missing or invalid body parameters. Must include categoryId, monthYear, availableHours, and availableMinutes.' });
    }

    const catId = parseInt(categoryId as string);
    const monthYearStr = monthYear as string;
    
    // TODO: Pass actual user ID from req.user/req.userId
    const userId = req.userId; 

    // Now we have the full scope, call the service
    await setMonthlyGoal(userId, catId, monthYearStr, availableHours, availableMinutes);

    res.json({ message: 'Monthly goal successfully set or updated.', goal: { availableHours, availableMinutes } });

  } catch (err) {
    next(err);
  }
});
