import type { WeeklySummary } from '@time-keeper/shared';

export type WeeklyExportFormat = 'csv' | 'plain' | 'compact';

const WEEKLY_EXPORT_FORMAT_KEY = 'time-keeper-weekly-export-format';

export interface WeeklyExportArtifact {
  format: WeeklyExportFormat;
  label: string;
  description: string;
  filename: string;
  mimeType: string;
  content: string;
}

interface ExportCategoryRow {
  categoryId: number;
  name: string;
  workdayCode: string | null;
  dayHours: number[];
  totalHours: number;
}

interface WeeklyExportData {
  rows: ExportCategoryRow[];
  dayTotals: number[];
  weekTotalHours: number;
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getStoredWeeklyExportFormat(): WeeklyExportFormat {
  if (!canUseStorage()) return 'csv';
  const value = window.localStorage.getItem(WEEKLY_EXPORT_FORMAT_KEY);
  return value === 'csv' || value === 'plain' || value === 'compact' ? value : 'csv';
}

export function setStoredWeeklyExportFormat(format: WeeklyExportFormat) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(WEEKLY_EXPORT_FORMAT_KEY, format);
}

export function getWeeklyExportFormats() {
  return [
    {
      value: 'csv' as const,
      label: 'CSV',
      description: 'Spreadsheet-friendly export with one row per category and one column per day.',
    },
    {
      value: 'plain' as const,
      label: 'Plain text',
      description: 'Readable weekly handoff summary with daily totals and category breakdowns.',
    },
    {
      value: 'compact' as const,
      label: 'Compact',
      description: 'Short copy-ready summary focused on per-category totals and weekly total.',
    },
  ];
}

function formatWeekday(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

function formatWeekdayWithDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatHours(hours: number, digits = 1) {
  return `${hours.toFixed(digits)}h`;
}

function getCategoryLabel(name: string, workdayCode: string | null) {
  return workdayCode ? `${name} (${workdayCode})` : name;
}

function buildWeeklyExportData(summary: WeeklySummary): WeeklyExportData {
  const categories = new Map<number, { name: string; workdayCode: string | null }>();

  for (const day of summary.days) {
    for (const category of day.categories) {
      if (!categories.has(category.categoryId)) {
        categories.set(category.categoryId, {
          name: category.name,
          workdayCode: category.workdayCode,
        });
      }
    }
  }

  const rows: ExportCategoryRow[] = Array.from(categories.entries()).map(([categoryId, category]) => {
    const dayHours = summary.days.map((day) => {
      const found = day.categories.find((item) => item.categoryId === categoryId);
      return (found?.minutes ?? 0) / 60;
    });

    return {
      categoryId,
      name: category.name,
      workdayCode: category.workdayCode,
      dayHours,
      totalHours: dayHours.reduce((sum, value) => sum + value, 0),
    };
  }).filter((row) => row.totalHours > 0);

  const dayTotals = summary.days.map((day) => day.totalMinutes / 60);

  return {
    rows,
    dayTotals,
    weekTotalHours: summary.totalMinutes / 60,
  };
}

function buildCsv(summary: WeeklySummary, data: WeeklyExportData): WeeklyExportArtifact {
  const header = ['Category', 'Workday Code', ...summary.days.map((day) => day.date), 'Total'];
  const rows = data.rows.map((row) => [
    row.name,
    row.workdayCode ?? '',
    ...row.dayHours.map((hours) => hours > 0 ? hours.toFixed(2) : '0.00'),
    row.totalHours.toFixed(2),
  ]);
  const totals = ['Total', '', ...data.dayTotals.map((hours) => hours.toFixed(2)), data.weekTotalHours.toFixed(2)];

  const content = [header, ...rows, totals]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  return {
    format: 'csv',
    label: 'CSV export',
    description: 'Download-ready CSV for spreadsheets or payroll tools.',
    filename: `time-keeper-${summary.week}.csv`,
    mimeType: 'text/csv;charset=utf-8;',
    content,
  };
}

function buildPlainText(summary: WeeklySummary, data: WeeklyExportData): WeeklyExportArtifact {
  const goalHours = summary.goalMinutes / 60;
  const rowLines = data.rows.map((row) => {
    const dailyBreakdown = summary.days
      .map((day, index) => `${formatWeekday(day.date)} ${formatHours(row.dayHours[index])}`)
      .join(', ');

    return `- ${getCategoryLabel(row.name, row.workdayCode)}: ${dailyBreakdown} · Total ${formatHours(row.totalHours)}`;
  });

  const dayLines = summary.days.map((day, index) =>
    `- ${formatWeekdayWithDate(day.date)}: ${formatHours(data.dayTotals[index])}`
  );

  const content = [
    `Time Keeper — Week ${summary.week}`,
    `Total: ${formatHours(data.weekTotalHours)} / Goal ${formatHours(goalHours)}`,
    '',
    'Categories',
    ...rowLines,
    '',
    'Daily totals',
    ...dayLines,
  ].join('\n');

  return {
    format: 'plain',
    label: 'Plain-text summary',
    description: 'Readable summary for chat, email, or notes.',
    filename: `time-keeper-${summary.week}.txt`,
    mimeType: 'text/plain;charset=utf-8;',
    content,
  };
}

function buildCompactText(summary: WeeklySummary, data: WeeklyExportData): WeeklyExportArtifact {
  const content = [
    `Week ${summary.week}`,
    ...data.rows.map((row) => `${row.workdayCode ?? row.name}: ${formatHours(row.totalHours, 2)}`),
    `TOTAL: ${formatHours(data.weekTotalHours, 2)}`,
  ].join('\n');

  return {
    format: 'compact',
    label: 'Compact summary',
    description: 'Short copy-ready summary focused on totals.',
    filename: `time-keeper-${summary.week}-compact.txt`,
    mimeType: 'text/plain;charset=utf-8;',
    content,
  };
}

export function buildWeeklyExport(summary: WeeklySummary, format: WeeklyExportFormat): WeeklyExportArtifact {
  const data = buildWeeklyExportData(summary);

  if (format === 'plain') return buildPlainText(summary, data);
  if (format === 'compact') return buildCompactText(summary, data);
  return buildCsv(summary, data);
}
