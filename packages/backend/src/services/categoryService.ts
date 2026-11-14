import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { categories } from '../db/schema.js';
import { createError } from '../middleware/errorHandler.js';

/**
 * Assert that `categoryId` exists and belongs to `userId`.
 *
 * One implementation, used by every route and service that writes a time
 * entry. `startTimer` calls it inside the service (finding H-2) so a future
 * caller cannot start a timer against another user's category by forgetting a
 * route-level check.
 *
 * `status` defaults to 400 for write payloads that name a foreign category;
 * callers that look up an existing resource by id may pass 404 instead.
 */
export function assertOwnedCategory(userId: string, categoryId: number, status = 400): void {
  const row = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .get();

  if (!row) {
    throw createError('Category not found', status);
  }
}
