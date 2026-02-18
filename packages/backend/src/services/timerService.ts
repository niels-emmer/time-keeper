import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries } from '../db/schema.js';
import { createError } from '../middleware/errorHandler.js';

/**
 * Get the currently running timer for a user, if any.
 */
export function getActiveTimer(userId: string) {
  return db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)))
    .get();
}

/**
 * Start a new timer for the given category.
 * Automatically stops any currently running timer first.
 */
export function startTimer(userId: string, categoryId: number) {
  const now = new Date().toISOString();

  // Auto-stop any running timer
  const active = getActiveTimer(userId);
  if (active) {
    db.update(timeEntries)
      .set({ endTime: now, updatedAt: now })
      .where(eq(timeEntries.id, active.id))
      .run();
  }

  const result = db
    .insert(timeEntries)
    .values({ userId, categoryId, startTime: now })
    .returning()
    .get();

  if (!result) throw createError('Failed to create timer entry', 500);
  return result;
}

/**
 * Stop the currently running timer for a user.
 */
export function stopTimer(userId: string) {
  const active = getActiveTimer(userId);
  if (!active) throw createError('No active timer', 400);

  const now = new Date().toISOString();
  const result = db
    .update(timeEntries)
    .set({ endTime: now, updatedAt: now })
    .where(eq(timeEntries.id, active.id))
    .returning()
    .get();

  if (!result) throw createError('Failed to stop timer', 500);
  return result;
}
