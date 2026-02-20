/**
 * End-of-day rounding algorithm.
 *
 * Rules:
 * - Round each category's raw minutes UP to the nearest rounding increment (30 or 60 min).
 * - If the resulting day total would push the ISO week over the weekly goal,
 *   cap the day at the remaining weekly headroom.
 *   Excess is removed from the category with the most minutes (greedy smallest-first removal).
 * - Already-rounded entries are not re-rounded (idempotent via `rounded` flag).
 * - A day with 0 minutes produces no rounding adjustments.
 */

export const DAILY_GOAL_MINUTES = 480; // 8h
export const WEEKLY_GOAL_MINUTES = 2400; // 40h
export const HOUR_IN_MINUTES = 60;
export const DEFAULT_ROUNDING_INCREMENT = 60; // minutes

export interface CategoryRaw {
  categoryId: number;
  minutes: number; // raw minutes for this category on this day
}

export interface CategoryRounded {
  categoryId: number;
  rawMinutes: number;
  roundedMinutes: number; // what the category should be after rounding
}

/**
 * Compute per-category rounded minutes for a single day.
 *
 * @param categories  Raw minutes per category for the day (only unrounded entries)
 * @param weekMinutesSoFar  Total minutes booked earlier in the week (excluding this day)
 * @param weeklyGoalMinutes  Weekly cap in minutes (defaults to WEEKLY_GOAL_MINUTES = 2400)
 * @param roundingIncrementMinutes  Rounding increment in minutes — 30 or 60 (defaults to 60)
 * @returns Per-category rounding result
 */
export function computeRounding(
  categories: CategoryRaw[],
  weekMinutesSoFar: number,
  weeklyGoalMinutes: number = WEEKLY_GOAL_MINUTES,
  roundingIncrementMinutes: number = DEFAULT_ROUNDING_INCREMENT
): { result: CategoryRounded[]; weekWouldExceed: boolean; capped: boolean } {
  if (categories.length === 0 || categories.every((c) => c.minutes === 0)) {
    return {
      result: categories.map((c) => ({ categoryId: c.categoryId, rawMinutes: c.minutes, roundedMinutes: c.minutes })),
      weekWouldExceed: false,
      capped: false,
    };
  }

  // Step 1: Round each category up to nearest increment
  const rounded: CategoryRounded[] = categories.map((c) => ({
    categoryId: c.categoryId,
    rawMinutes: c.minutes,
    roundedMinutes:
      c.minutes === 0
        ? 0
        : Math.ceil(c.minutes / roundingIncrementMinutes) * roundingIncrementMinutes,
  }));

  const dayRoundedTotal = rounded.reduce((sum, c) => sum + c.roundedMinutes, 0);
  const projectedWeekTotal = weekMinutesSoFar + dayRoundedTotal;

  if (projectedWeekTotal <= weeklyGoalMinutes) {
    return { result: rounded, weekWouldExceed: false, capped: false };
  }

  // Step 2: Week would exceed goal — cap at remaining headroom
  const headroom = Math.max(0, weeklyGoalMinutes - weekMinutesSoFar);
  let excess = dayRoundedTotal - headroom;

  // Remove excess from categories with the most rounded minutes (largest first),
  // but never reduce below raw minutes (no negative "rounding").
  const capped = rounded
    .map((c) => ({ ...c }))
    .sort((a, b) => b.roundedMinutes - a.roundedMinutes);

  for (const cat of capped) {
    if (excess <= 0) break;
    const reducible = cat.roundedMinutes - cat.rawMinutes; // can only remove the rounding bonus
    const remove = Math.min(excess, reducible);
    cat.roundedMinutes -= remove;
    excess -= remove;
  }

  // Re-merge back to original order
  const cappedById = new Map(capped.map((c) => [c.categoryId, c]));
  const result = rounded.map((c) => cappedById.get(c.categoryId) ?? c);

  return { result, weekWouldExceed: true, capped: true };
}
