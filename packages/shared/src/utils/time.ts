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

// ── Local-day bucketing (DEC-2 / finding H-3) ──────────────────────────────
//
// Storage stays UTC (invariant I-004). These helpers answer "which calendar day
// is this instant for this user?" using the IANA tz database through
// `Intl.DateTimeFormat`, so DST transitions are handled by the runtime rather
// than by fixed offsets.

export const DEFAULT_TIME_ZONE = 'UTC';

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True when `timeZone` is an IANA zone name the runtime understands. */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
    // ES2024 also accepts raw UTC offsets like `+02:00`. They carry no DST
    // rules, so they are not a valid "local day" definition here.
    return !/^[+-]/.test(resolved);
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatZonedParts(instantMs: number, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(instantMs));
  const value = (type: string) => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : NaN;
  };

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** Offset (local − UTC) in minutes at a given instant, for `timeZone`. */
function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const parts = formatZonedParts(instantMs, timeZone);
  const asUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const instantSecond = Math.floor(instantMs / 1000) * 1000;
  return Math.round((asUtcMs - instantSecond) / 60_000);
}

/** UTC instant of local midnight on `dayKey` in `timeZone`. */
function localMidnightMs(dayKey: string, timeZone: string): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  const wallAsUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  // A wall-clock time maps to an instant via the zone offset. The offset can
  // change at the instant itself (DST boundary), so resolve twice.
  const firstGuess = wallAsUtcMs - offsetMinutesAt(wallAsUtcMs, timeZone) * 60_000;
  return wallAsUtcMs - offsetMinutesAt(firstGuess, timeZone) * 60_000;
}

function assertDayKey(dayKey: string): void {
  if (!DAY_KEY_PATTERN.test(dayKey)) {
    throw new RangeError(`Invalid day key "${dayKey}" (expected YYYY-MM-DD)`);
  }
}

/** Add calendar days to a `YYYY-MM-DD` key. */
export function addDaysToDayKey(dayKey: string, days: number): string {
  assertDayKey(dayKey);
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

/** The local calendar day (`YYYY-MM-DD`) of a UTC ISO instant. */
export function localDayKey(isoUtc: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const instantMs = new Date(isoUtc).getTime();
  if (!Number.isFinite(instantMs)) {
    throw new RangeError(`Invalid ISO timestamp "${isoUtc}"`);
  }
  const parts = formatZonedParts(instantMs, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * Half-open UTC range for a local calendar day: `[start, endExclusive)`.
 *
 * `endExclusive` is the next local midnight, so a spring-forward day is 23 h
 * and a fall-back day is 25 h without any special cases.
 */
export function localDayBounds(
  dayKey: string,
  timeZone: string = DEFAULT_TIME_ZONE
): { start: Date; endExclusive: Date } {
  assertDayKey(dayKey);
  return {
    start: new Date(localMidnightMs(dayKey, timeZone)),
    endExclusive: new Date(localMidnightMs(addDaysToDayKey(dayKey, 1), timeZone)),
  };
}

