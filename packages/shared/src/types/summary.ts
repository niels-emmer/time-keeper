import type { CategoryTargetCadence } from './category.js';

export interface CategorySummary {
  categoryId: number;
  name: string;
  color: string;
  workdayCode: string | null;
  minutes: number;
  roundedHours: number;
}

export interface DaySummary {
  date: string; // YYYY-MM-DD
  totalMinutes: number;
  goalMinutes: number; // 480 (8h)
  categories: CategorySummary[];
}

export interface WeeklySummary {
  week: string; // YYYY-Www (ISO week)
  totalMinutes: number;
  goalMinutes: number; // 2400 (40h)
  days: DaySummary[];
}

export type MonthlyCategoryStatus = 'no-goal' | 'on-pace' | 'behind' | 'over-target';

export interface MonthlyCategorySummary {
  categoryId: number;
  name: string;
  color: string;
  workdayCode: string | null;
  billable: boolean;
  targetCadence: CategoryTargetCadence | null;
  actualMinutes: number;
  progressMinutes: number;
  goalMinutes: number;
  expectedMinutesByNow: number;
  remainingMinutes: number;
  projectedMinutes: number;
  requiredDailyMinutes: number;
  status: MonthlyCategoryStatus;
}

export interface MonthlySummary {
  monthYear: string; // YYYY-MM
  monthLabel: string;
  isCurrentMonth: boolean;
  daysElapsed: number;
  daysInMonth: number;
  remainingDays: number;
  totalActualMinutes: number;
  totalGoalMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  categories: MonthlyCategorySummary[];
}

export interface RoundingResult {
  date: string;
  roundingApplied: boolean;
  weekWouldExceed: boolean;
  adjustedEntries: Array<{ entryId: number; oldMinutes: number; newMinutes: number }>;
}
