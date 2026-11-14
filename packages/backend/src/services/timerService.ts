import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries } from '../db/schema.js';
import { createError } from '../middleware/errorHandler.js';
import { assertOwnedCategory } from './categoryService.js';

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
 *
 * Throws 400 when the category does not belong to `userId` (finding H-2): the
 * guard lives here, not only in the route, so every caller inherits it.
 */
export function startTimer(userId: string, categoryId: number) {
  assertOwnedCategory(userId, categoryId);

  const now = new Date().toISOString();

  const result = db.transaction(() => {
    // Auto-stop any running timer
    const active = getActiveTimer(userId);
    if (active) {
      db.update(timeEntries)
        .set({ endTime: now, updatedAt: now })
        .where(and(eq(timeEntries.id, active.id), eq(timeEntries.userId, userId)))
        .run();
    }

    return db
      .insert(timeEntries)
      .values({ userId, categoryId, startTime: now })
      .returning()
      .get();
  });

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
    .where(and(eq(timeEntries.id, active.id), eq(timeEntries.userId, userId)))
    .returning()
    .get();

  if (!result) throw createError('Failed to stop timer', 500);
  return result;
}
