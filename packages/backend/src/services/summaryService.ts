import { eq, and, gte, lte, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries, categories, userSettings } from '../db/schema.js';
import { isoWeekBounds, toDateString, toISOWeek } from '@time-keeper/shared';
import type { WeeklySummary, DaySummary, CategorySummary } from '@time-keeper/shared';

function getWeeklyGoalMinutes(userId: string): number {
  const row = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
  const hours = row?.weeklyGoalHours ?? 40;
  return hours * 60;
}

/**
 * Build a weekly summary for the given ISO week string (e.g. "2026-W07").
 * Only includes completed entries (endTime IS NOT NULL).
 */
export function getWeeklySummary(userId: string, week: string): WeeklySummary {
  const { start, end } = isoWeekBounds(week);

  const startStr = start.toISOString();
  const endStr = new Date(end.getTime() + 86399999).toISOString(); // end of Sunday

  const entries = db
    .select({
      id: timeEntries.id,
      categoryId: timeEntries.categoryId,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      rounded: timeEntries.rounded,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryWorkdayCode: categories.workdayCode,
    })
    .from(timeEntries)
    .innerJoin(categories, eq(timeEntries.categoryId, categories.id))
    .where(
      and(
        eq(timeEntries.userId, userId),
        isNotNull(timeEntries.endTime),
        gte(timeEntries.startTime, startStr),
        lte(timeEntries.startTime, endStr)
      )
    )
    .all();

  const weeklyGoalMinutes = getWeeklyGoalMinutes(userId);
  const dailyGoalMinutes = Math.round(weeklyGoalMinutes / 5); // 5 working days

  // Group by day then by category
  const byDay = new Map<string, typeof entries>();
  for (const entry of entries) {
    const dateStr = entry.startTime.slice(0, 10);
    if (!byDay.has(dateStr)) byDay.set(dateStr, []);
    byDay.get(dateStr)!.push(entry);
  }

  // Build all 7 days of the week
  const days: DaySummary[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    const dateStr = toDateString(day);
    const dayEntries = byDay.get(dateStr) ?? [];

    const byCat = new Map<number, CategorySummary>();
    for (const e of dayEntries) {
      const durationMs = new Date(e.endTime!).getTime() - new Date(e.startTime).getTime();
      const minutes = Math.floor(durationMs / 60000);

      if (!byCat.has(e.categoryId)) {
        byCat.set(e.categoryId, {
          categoryId: e.categoryId,
          name: e.categoryName,
          color: e.categoryColor,
          workdayCode: e.categoryWorkdayCode,
          minutes: 0,
          roundedHours: 0,
        });
      }
      byCat.get(e.categoryId)!.minutes += minutes;
    }

    const catSummaries = Array.from(byCat.values()).map((c) => ({
      ...c,
      roundedHours: Math.round(c.minutes / 60 * 10) / 10,
    }));

    const totalMinutes = catSummaries.reduce((sum, c) => sum + c.minutes, 0);
    days.push({ date: dateStr, totalMinutes, goalMinutes: dailyGoalMinutes, categories: catSummaries });
  }

  const totalMinutes = days.reduce((sum, d) => sum + d.totalMinutes, 0);

  return { week, totalMinutes, goalMinutes: weeklyGoalMinutes, days };
}

/**
 * Get total booked minutes for the current week up to (but not including) a given date.
 */
export function getWeekMinutesBefore(userId: string, date: string): number {
  const week = toISOWeek(new Date(date));
  const { start } = isoWeekBounds(week);
  const startStr = start.toISOString();
  const endStr = `${date}T00:00:00.000Z`;

  const result = db
    .select({ startTime: timeEntries.startTime, endTime: timeEntries.endTime })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        isNotNull(timeEntries.endTime),
        gte(timeEntries.startTime, startStr),
        lte(timeEntries.startTime, endStr)
      )
    )
    .all();

  return result.reduce((sum, e) => {
    const ms = new Date(e.endTime!).getTime() - new Date(e.startTime).getTime();
    return sum + Math.floor(ms / 60000);
  }, 0);
}

/**
 * Get the user's weekly goal in minutes.
 */
export { getWeeklyGoalMinutes };
