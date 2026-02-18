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

export interface RoundingResult {
  date: string;
  roundingApplied: boolean;
  weekWouldExceed: boolean;
  adjustedEntries: Array<{ entryId: number; oldMinutes: number; newMinutes: number }>;
}
