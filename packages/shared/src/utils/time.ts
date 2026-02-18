/**
 * Format a duration in minutes as "Xh Ym" or "Xh" or "Ym"
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Format elapsed seconds as "H:MM:SS"
 */
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Get elapsed minutes between two ISO timestamps (or now if endTime is null)
 */
export function elapsedMinutes(startTime: string, endTime: string | null): number {
  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  return Math.floor((end - start) / 60000);
}

/**
 * Get ISO week string (YYYY-Www) for a given date
 */
export function toISOWeek(date: Date): string {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Get start (Monday) and end (Sunday) dates for an ISO week string
 */
export function isoWeekBounds(week: string): { start: Date; end: Date } {
  const [yearStr, weekStr] = week.split('-W');
  const year = parseInt(yearStr, 10);
  const weekNo = parseInt(weekStr, 10);

  // Jan 4 is always in week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekStart = new Date(jan4);
  weekStart.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1 + (weekNo - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  return { start: weekStart, end: weekEnd };
}

/**
 * Format a Date as YYYY-MM-DD in UTC
 */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
