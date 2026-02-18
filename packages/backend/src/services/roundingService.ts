import { eq, and, gte, lte, isNotNull, eq as drizzleEq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries, categories } from '../db/schema.js';
import { computeRounding } from '@time-keeper/shared';
import { getWeekMinutesBefore } from './summaryService.js';
import type { RoundingResult } from '@time-keeper/shared';

/**
 * Apply end-of-day rounding for a specific date.
 * Idempotent: already-rounded entries are excluded from rounding input.
 */
export function applyRounding(userId: string, date: string): RoundingResult {
  const startStr = `${date}T00:00:00.000Z`;
  const endStr = `${date}T23:59:59.999Z`;

  // Get all completed, not-yet-rounded entries for this day
  const dayEntries = db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        isNotNull(timeEntries.endTime),
        eq(timeEntries.rounded, false),
        gte(timeEntries.startTime, startStr),
        lte(timeEntries.startTime, endStr)
      )
    )
    .all();

  if (dayEntries.length === 0) {
    return { date, roundingApplied: false, weekWouldExceed: false, adjustedEntries: [] };
  }

  // Aggregate raw minutes per category
  const byCat = new Map<number, number>();
  for (const e of dayEntries) {
    const ms = new Date(e.endTime!).getTime() - new Date(e.startTime).getTime();
    const minutes = Math.floor(ms / 60000);
    byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + minutes);
  }

  const weekMinutesSoFar = getWeekMinutesBefore(userId, date);

  const categoriesInput = Array.from(byCat.entries()).map(([categoryId, minutes]) => ({
    categoryId,
    minutes,
  }));

  const { result, weekWouldExceed } = computeRounding(categoriesInput, weekMinutesSoFar);

  // Build a map of categoryId → target total rounded minutes
  const roundedByCat = new Map(result.map((r) => [r.categoryId, r.roundedMinutes]));
  const rawByCat = new Map(result.map((r) => [r.categoryId, r.rawMinutes]));

  const adjustedEntries: RoundingResult['adjustedEntries'] = [];
  const now = new Date().toISOString();

  // For each category that changed, adjust the last entry of that category by
  // the delta (add/remove minutes from its end time)
  const grouped = new Map<number, typeof dayEntries>();
  for (const e of dayEntries) {
    if (!grouped.has(e.categoryId)) grouped.set(e.categoryId, []);
    grouped.get(e.categoryId)!.push(e);
  }

  for (const [catId, entries] of grouped.entries()) {
    const rawTotal = rawByCat.get(catId) ?? 0;
    const roundedTotal = roundedByCat.get(catId) ?? rawTotal;
    const delta = roundedTotal - rawTotal; // minutes to add

    if (delta === 0) {
      // Still mark as rounded so we don't re-process
      for (const e of entries) {
        db.update(timeEntries).set({ rounded: true, updatedAt: now }).where(eq(timeEntries.id, e.id)).run();
      }
      continue;
    }

    // Apply the delta to the last entry of this category for this day
    const lastEntry = entries.sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
    const oldEndTime = new Date(lastEntry.endTime!);
    const newEndTime = new Date(oldEndTime.getTime() + delta * 60000);

    const oldMinutes = Math.floor(
      (oldEndTime.getTime() - new Date(lastEntry.startTime).getTime()) / 60000
    );
    const newMinutes = Math.floor(
      (newEndTime.getTime() - new Date(lastEntry.startTime).getTime()) / 60000
    );

    db.update(timeEntries)
      .set({ endTime: newEndTime.toISOString(), rounded: true, updatedAt: now })
      .where(eq(timeEntries.id, lastEntry.id))
      .run();

    // Mark all other entries in this category as rounded (no time change)
    for (const e of entries) {
      if (e.id !== lastEntry.id) {
        db.update(timeEntries).set({ rounded: true, updatedAt: now }).where(eq(timeEntries.id, e.id)).run();
      }
    }

    adjustedEntries.push({ entryId: lastEntry.id, oldMinutes, newMinutes });
  }

  return {
    date,
    roundingApplied: adjustedEntries.length > 0,
    weekWouldExceed,
    adjustedEntries,
  };
}
