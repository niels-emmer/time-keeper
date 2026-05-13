import { eq, and, gte, lte, isNotNull, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries, categories, userSettings, monthlyProjectGoals } from '../db/schema.js';
import { isoWeekBounds, toDateString, toISOWeek } from '@time-keeper/shared';
import type {
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

export function getWeeklySummary(userId: string, week: string): WeeklySummary {
  const { start, end } = isoWeekBounds(week);

  const startStr = start.toISOString();
  const endStr = new Date(end.getTime() + 86399999).toISOString();

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
  const dailyGoalMinutes = Math.round(weeklyGoalMinutes / 5);

  const byDay = new Map<string, typeof entries>();
  for (const entry of entries) {
    const dateStr = entry.startTime.slice(0, 10);
    if (!byDay.has(dateStr)) byDay.set(dateStr, []);
    byDay.get(dateStr)!.push(entry);
  }

  const days: DaySummary[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    const dateStr = toDateString(day);
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

function getMonthBounds(monthYear: string) {
  const [yearStr, monthStr] = monthYear.split('-');
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;

  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  return { start, end, year, monthIndex, daysInMonth };
}

function getMonthLabel(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function getDaysElapsed(monthYear: string, daysInMonth: number) {
  const now = new Date();
  const currentMonthYear = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  if (monthYear < currentMonthYear) return daysInMonth;
  if (monthYear > currentMonthYear) return 0;
  return Math.min(now.getUTCDate(), daysInMonth);
}

function computeMonthlyStatus(goalMinutes: number, actualMinutes: number, expectedMinutesByNow: number): MonthlyCategoryStatus {
  if (goalMinutes === 0) return 'no-goal';
  if (actualMinutes > goalMinutes) return 'over-target';
  if (actualMinutes + 30 < expectedMinutesByNow) return 'behind';
  return 'on-pace';
}

export function buildMonthlySummaryData(input: {
  monthYear: string;
  monthLabel: string;
  daysElapsed: number;
  daysInMonth: number;
  categories: Array<{
    id: number;
    name: string;
    color: string;
    workdayCode: string | null;
    billable: boolean;
    sortOrder: number;
  }>;
  goals: Array<{
    categoryId: number;
    availableHours: number;
    availableMinutes: number;
  }>;
  entries: Array<{
    categoryId: number;
    startTime: string;
    endTime: string;
  }>;
}): MonthlySummary {
  const actualMinutesByCategory = new Map<number, number>();

  for (const entry of input.entries) {
    const durationMs = new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime();
    const minutes = Math.max(0, Math.floor(durationMs / 60000));
    actualMinutesByCategory.set(entry.categoryId, (actualMinutesByCategory.get(entry.categoryId) ?? 0) + minutes);
  }

  const goalsByCategory = new Map(
    input.goals.map((goal) => [goal.categoryId, goal.availableHours * 60 + goal.availableMinutes] as const)
  );

  const remainingDays = Math.max(input.daysInMonth - input.daysElapsed, 0);

  const categorySummaries: MonthlyCategorySummary[] = input.categories.map((category) => {
    const actualMinutes = actualMinutesByCategory.get(category.id) ?? 0;
    const goalMinutes = goalsByCategory.get(category.id) ?? 0;
    const expectedMinutesByNow = input.daysElapsed > 0
      ? Math.round(goalMinutes * (input.daysElapsed / input.daysInMonth))
      : 0;
    const projectedMinutes = input.daysElapsed > 0
      ? Math.round((actualMinutes / input.daysElapsed) * input.daysInMonth)
      : 0;
    const remainingMinutes = Math.max(goalMinutes - actualMinutes, 0);
    const requiredDailyMinutes = remainingDays > 0
      ? Math.ceil(remainingMinutes / remainingDays)
      : 0;

    return {
      categoryId: category.id,
      name: category.name,
      color: category.color,
      workdayCode: category.workdayCode,
      billable: category.billable,
      actualMinutes,
      goalMinutes,
      expectedMinutesByNow,
      remainingMinutes,
      projectedMinutes,
      requiredDailyMinutes,
      status: computeMonthlyStatus(goalMinutes, actualMinutes, expectedMinutesByNow),
    };
  });

  const totalActualMinutes = categorySummaries.reduce((sum, category) => sum + category.actualMinutes, 0);
  const totalGoalMinutes = categorySummaries.reduce((sum, category) => sum + category.goalMinutes, 0);
  const billableMinutes = categorySummaries.reduce(
    (sum, category) => sum + (category.billable ? category.actualMinutes : 0),
    0
  );
  const nonBillableMinutes = totalActualMinutes - billableMinutes;
  const currentMonthYear = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;

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
  const { start, end, year, monthIndex, daysInMonth } = getMonthBounds(monthYear);
  const daysElapsed = getDaysElapsed(monthYear, daysInMonth);

  const categoryRows = db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      workdayCode: categories.workdayCode,
      billable: categories.billable,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.sortOrder))
    .all();

  const goalRows = db
    .select({
      categoryId: monthlyProjectGoals.categoryId,
      availableHours: monthlyProjectGoals.availableHours,
      availableMinutes: monthlyProjectGoals.availableMinutes,
    })
    .from(monthlyProjectGoals)
    .where(and(eq(monthlyProjectGoals.userId, userId), eq(monthlyProjectGoals.monthYear, monthYear)))
    .all();

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
        gte(timeEntries.startTime, start.toISOString()),
        lte(timeEntries.startTime, end.toISOString())
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
    daysElapsed,
    daysInMonth,
    categories: categoryRows,
    goals: goalRows,
    entries: entryRows,
  });
}

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
