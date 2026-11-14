import { eq, and, gte, lt, isNotNull, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries, categories, userSettings } from '../db/schema.js';
import {
  isoWeekBounds,
  toDateString,
  toISOWeek,
  localDayKey,
  localDayBounds,
  addDaysToDayKey,
} from '@time-keeper/shared';
import type {
  CategoryTargetCadence,
  WeeklySummary,
  DaySummary,
  CategorySummary,
  MonthlyCategorySummary,
  MonthlyCategoryStatus,
  MonthlySummary,
} from '@time-keeper/shared';

function getWeeklyGoalMinutes(userId: string): number {
  const row = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
  const hours = row?.weeklyGoalHours ?? 40;
  return hours * 60;
}

function getRoundingIncrementMinutes(userId: string): number {
  const row = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
  return row?.roundingIncrementMinutes ?? 60;
}

/**
 * The user's IANA time zone for local-day bucketing (DEC-2 / finding H-3).
 * An install that never touched settings has no row, or a row defaulted to
 * UTC, so behaviour is unchanged until the user picks a zone.
 */
export function getUserTimeZone(userId: string): string {
  const row = db
    .select({ timezone: userSettings.timezone })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .get();
  return row?.timezone ?? 'UTC';
}

export function getWeeklySummary(userId: string, week: string): WeeklySummary {
  const timeZone = getUserTimeZone(userId);
  const { start } = isoWeekBounds(week);
  const weekStartKey = toDateString(start);
  const dayKeys = Array.from({ length: 7 }, (_, index) => addDaysToDayKey(weekStartKey, index));

  // The ISO week is Monday..Sunday as local calendar days, so the UTC window
  // is the local Monday midnight through the local next-Monday midnight
  // (half-open), which absorbs DST shifts.
  const startStr = localDayBounds(dayKeys[0], timeZone).start.toISOString();
  const endStr = localDayBounds(dayKeys[6], timeZone).endExclusive.toISOString();

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
        lt(timeEntries.startTime, endStr)
      )
    )
    .all();

  const weeklyGoalMinutes = getWeeklyGoalMinutes(userId);
  const dailyGoalMinutes = Math.round(weeklyGoalMinutes / 5);

  const byDay = new Map<string, typeof entries>();
  for (const entry of entries) {
    const dateStr = localDayKey(entry.startTime, timeZone);
    if (!byDay.has(dateStr)) byDay.set(dateStr, []);
    byDay.get(dateStr)!.push(entry);
  }

  const days: DaySummary[] = [];
  for (const dateStr of dayKeys) {
    const dayEntries = byDay.get(dateStr) ?? [];

    const byCat = new Map<number, CategorySummary>();
    for (const entry of dayEntries) {
      const durationMs = new Date(entry.endTime!).getTime() - new Date(entry.startTime).getTime();
      const minutes = Math.floor(durationMs / 60000);

      if (!byCat.has(entry.categoryId)) {
        byCat.set(entry.categoryId, {
          categoryId: entry.categoryId,
          name: entry.categoryName,
          color: entry.categoryColor,
          workdayCode: entry.categoryWorkdayCode,
          minutes: 0,
          roundedHours: 0,
        });
      }
      byCat.get(entry.categoryId)!.minutes += minutes;
    }

    const catSummaries = Array.from(byCat.values()).map((category) => ({
      ...category,
      roundedHours: Math.round(category.minutes / 60 * 10) / 10,
    }));

    const totalMinutes = catSummaries.reduce((sum, category) => sum + category.minutes, 0);
    days.push({ date: dateStr, totalMinutes, goalMinutes: dailyGoalMinutes, categories: catSummaries });
  }

  const totalMinutes = days.reduce((sum, day) => sum + day.totalMinutes, 0);

  return { week, totalMinutes, goalMinutes: weeklyGoalMinutes, days };
}

function getMonthBounds(monthYear: string, timeZone: string) {
  const [yearStr, monthStr] = monthYear.split('-');
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;

  // Month bounds are the local midnights on either side of the month, so a
  // 00:30 local entry on the 1st belongs to this month (finding H-3).
  const startKey = `${monthYear}-01`;
  const nextMonthKey = toDateString(new Date(Date.UTC(year, monthIndex + 1, 1)));
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const start = localDayBounds(startKey, timeZone).start;
  const endExclusive = localDayBounds(nextMonthKey, timeZone).start;

  return { start, endExclusive, year, monthIndex, daysInMonth };
}

function getMonthLabel(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function getDaysElapsed(monthYear: string, daysInMonth: number, timeZone: string) {
  const currentDayKey = localDayKey(new Date().toISOString(), timeZone);
  const currentMonthYear = currentDayKey.slice(0, 7);

  if (monthYear < currentMonthYear) return daysInMonth;
  if (monthYear > currentMonthYear) return 0;
  return Math.min(Number(currentDayKey.slice(8, 10)), daysInMonth);
}

function computeMonthlyStatus(
  goalMinutes: number,
  progressMinutes: number,
  expectedMinutesByNow: number,
  targetCadence: CategoryTargetCadence | null
): MonthlyCategoryStatus {
  if (goalMinutes === 0) return 'no-goal';
  if (progressMinutes > goalMinutes) return 'over-target';
  if (targetCadence !== 'one_time' && progressMinutes + 30 < expectedMinutesByNow) return 'behind';
  return 'on-pace';
}

function getEffectiveGoalMinutes(
  targetCadence: CategoryTargetCadence | null,
  targetMinutes: number | null,
  daysInMonth: number,
  monthEndMs: number,
  targetStartedAt: string | null
) {
  if (!targetCadence || targetMinutes == null || targetMinutes <= 0) {
    return 0;
  }

  if (targetCadence === 'monthly') {
    return targetMinutes;
  }

  if (targetCadence === 'weekly') {
    return Math.round(targetMinutes * (daysInMonth / 7));
  }

  if (!targetStartedAt) {
    return 0;
  }

  const startMs = new Date(targetStartedAt).getTime();
  if (!Number.isFinite(startMs) || startMs > monthEndMs) {
    return 0;
  }

  return targetMinutes;
}

export function buildMonthlySummaryData(input: {
  monthYear: string;
  monthLabel: string;
  monthStart: string;
  monthEnd: string;
  daysElapsed: number;
  daysInMonth: number;
  categories: Array<{
    id: number;
    name: string;
    color: string;
    workdayCode: string | null;
    billable: boolean;
    sortOrder: number;
    targetCadence: CategoryTargetCadence | null;
    targetMinutes: number | null;
    targetStartedAt: string | null;
  }>;
  entries: Array<{
    categoryId: number;
    startTime: string;
    endTime: string;
  }>;
  /** Local "today" month key, e.g. `2026-04`. Defaults to the UTC month. */
  currentMonthYear?: string;
}): MonthlySummary {
  const monthStartMs = new Date(input.monthStart).getTime();
  const monthEndMs = new Date(input.monthEnd).getTime();
  const actualMinutesByCategory = new Map<number, number>();
  const entriesByCategory = new Map<number, Array<{ startMs: number; minutes: number }>>();

  for (const entry of input.entries) {
    const startMs = new Date(entry.startTime).getTime();
    const endMs = new Date(entry.endTime).getTime();
    const minutes = Math.max(0, Math.floor((endMs - startMs) / 60000));

    if (!Number.isFinite(startMs)) {
      continue;
    }

    if (startMs >= monthStartMs && startMs <= monthEndMs) {
      actualMinutesByCategory.set(entry.categoryId, (actualMinutesByCategory.get(entry.categoryId) ?? 0) + minutes);
    }

    if (!entriesByCategory.has(entry.categoryId)) {
      entriesByCategory.set(entry.categoryId, []);
    }
    entriesByCategory.get(entry.categoryId)!.push({ startMs, minutes });
  }

  const remainingDays = Math.max(input.daysInMonth - input.daysElapsed, 0);

  const categorySummaries: MonthlyCategorySummary[] = input.categories.map((category) => {
    const actualMinutes = actualMinutesByCategory.get(category.id) ?? 0;
    const goalMinutes = getEffectiveGoalMinutes(
      category.targetCadence,
      category.targetMinutes,
      input.daysInMonth,
      monthEndMs,
      category.targetStartedAt
    );

    const categoryEntries = entriesByCategory.get(category.id) ?? [];
    let progressMinutes = actualMinutes;
    let spentBeforeMonthMinutes = 0;

    if (category.targetCadence === 'one_time' && category.targetStartedAt) {
      const targetStartMs = new Date(category.targetStartedAt).getTime();

      if (Number.isFinite(targetStartMs) && targetStartMs <= monthEndMs) {
        progressMinutes = 0;
        spentBeforeMonthMinutes = 0;

        for (const entry of categoryEntries) {
          if (entry.startMs < targetStartMs || entry.startMs > monthEndMs) {
            continue;
          }

          progressMinutes += entry.minutes;
          if (entry.startMs < monthStartMs) {
            spentBeforeMonthMinutes += entry.minutes;
          }
        }
      }
    }

    const expectedMinutesByNow = goalMinutes > 0 && input.daysElapsed > 0 && category.targetCadence !== 'one_time'
      ? Math.round(goalMinutes * (input.daysElapsed / input.daysInMonth))
      : 0;
    const projectedMonthMinutes = input.daysElapsed > 0
      ? Math.round((actualMinutes / input.daysElapsed) * input.daysInMonth)
      : 0;
    const projectedMinutes = category.targetCadence === 'one_time'
      ? spentBeforeMonthMinutes + projectedMonthMinutes
      : projectedMonthMinutes;
    const remainingMinutes = goalMinutes - progressMinutes;
    const requiredDailyMinutes = remainingDays > 0 && remainingMinutes > 0
      ? Math.ceil(remainingMinutes / remainingDays)
      : 0;

    return {
      categoryId: category.id,
      name: category.name,
      color: category.color,
      workdayCode: category.workdayCode,
      billable: category.billable,
      targetCadence: category.targetCadence,
      actualMinutes,
      progressMinutes,
      goalMinutes,
      expectedMinutesByNow,
      remainingMinutes,
      projectedMinutes,
      requiredDailyMinutes,
      status: computeMonthlyStatus(goalMinutes, progressMinutes, expectedMinutesByNow, category.targetCadence),
    };
  });

  const totalActualMinutes = categorySummaries.reduce((sum, category) => sum + category.actualMinutes, 0);
  const totalGoalMinutes = categorySummaries.reduce((sum, category) => sum + category.goalMinutes, 0);
  const billableMinutes = categorySummaries.reduce(
    (sum, category) => sum + (category.billable ? category.actualMinutes : 0),
    0
  );
  const nonBillableMinutes = totalActualMinutes - billableMinutes;
  const currentMonthYear =
    input.currentMonthYear ??
    `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;

  return {
    monthYear: input.monthYear,
    monthLabel: input.monthLabel,
    isCurrentMonth: input.monthYear === currentMonthYear,
    daysElapsed: input.daysElapsed,
    daysInMonth: input.daysInMonth,
    remainingDays,
    totalActualMinutes,
    totalGoalMinutes,
    billableMinutes,
    nonBillableMinutes,
    categories: categorySummaries,
  };
}

export function getMonthlySummary(userId: string, monthYear: string): MonthlySummary {
  const timeZone = getUserTimeZone(userId);
  const { start, endExclusive, year, monthIndex, daysInMonth } = getMonthBounds(monthYear, timeZone);
  const daysElapsed = getDaysElapsed(monthYear, daysInMonth, timeZone);

  const categoryRows = db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      workdayCode: categories.workdayCode,
      billable: categories.billable,
      sortOrder: categories.sortOrder,
      targetCadence: categories.targetCadence,
      targetMinutes: categories.targetMinutes,
      targetStartedAt: categories.targetStartedAt,
    })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.sortOrder))
    .all();

  const entryWindowStartMs = categoryRows.reduce((earliest, category) => {
    if (category.targetCadence !== 'one_time' || !category.targetStartedAt) {
      return earliest;
    }

    const startMs = new Date(category.targetStartedAt).getTime();
    if (!Number.isFinite(startMs) || startMs > endExclusive.getTime()) {
      return earliest;
    }

    return Math.min(earliest, startMs);
  }, start.getTime());

  const entryRows = db
    .select({
      categoryId: timeEntries.categoryId,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        isNotNull(timeEntries.endTime),
        gte(timeEntries.startTime, new Date(entryWindowStartMs).toISOString()),
        lt(timeEntries.startTime, endExclusive.toISOString())
      )
    )
    .all()
    .map((entry) => ({
      categoryId: entry.categoryId,
      startTime: entry.startTime,
      endTime: entry.endTime!,
    }));

  return buildMonthlySummaryData({
    monthYear,
    monthLabel: getMonthLabel(year, monthIndex),
    monthStart: start.toISOString(),
    monthEnd: new Date(endExclusive.getTime() - 1).toISOString(),
    daysElapsed,
    daysInMonth,
    categories: categoryRows,
    entries: entryRows,
    currentMonthYear: localDayKey(new Date().toISOString(), timeZone).slice(0, 7),
  });
}

export function getWeekMinutesBefore(userId: string, date: string): number {
  const timeZone = getUserTimeZone(userId);
  const week = toISOWeek(new Date(date));
  const mondayKey = toDateString(isoWeekBounds(week).start);
  const startStr = localDayBounds(mondayKey, timeZone).start.toISOString();
  // Half-open: an entry at exactly this day's local midnight belongs to the
  // day's own rounding bucket, not to "before" (finding L-4).
  const endStr = localDayBounds(date, timeZone).start.toISOString();

  const result = db
    .select({ startTime: timeEntries.startTime, endTime: timeEntries.endTime })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        isNotNull(timeEntries.endTime),
        gte(timeEntries.startTime, startStr),
        lt(timeEntries.startTime, endStr)
      )
    )
    .all();

  return result.reduce((sum, entry) => {
    const ms = new Date(entry.endTime!).getTime() - new Date(entry.startTime).getTime();
    return sum + Math.floor(ms / 60000);
  }, 0);
}

export { getWeeklyGoalMinutes };
export { getRoundingIncrementMinutes };

export function getWeekDateRange(week: string): { dates: string[] } {
  const { start } = isoWeekBounds(week);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    dates.push(toDateString(d));
  }
  return { dates };
}
