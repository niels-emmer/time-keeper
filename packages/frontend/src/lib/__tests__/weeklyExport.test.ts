import { beforeEach, describe, expect, it } from 'vitest';
import type { WeeklySummary } from '@time-keeper/shared';
import {
  buildWeeklyExport,
  getStoredWeeklyExportFormat,
  setStoredWeeklyExportFormat,
} from '../weeklyExport';

const weeklySummary: WeeklySummary = {
  week: '2026-W20',
  totalMinutes: 420,
  goalMinutes: 2400,
  days: [
    {
      date: '2026-05-11',
      totalMinutes: 180,
      goalMinutes: 480,
      categories: [
        {
          categoryId: 1,
          name: 'Project Alpha',
          color: '#3366ff',
          workdayCode: 'ALPHA',
          minutes: 120,
          roundedHours: 2,
        },
        {
          categoryId: 2,
          name: 'Support',
          color: '#22aa66',
          workdayCode: null,
          minutes: 60,
          roundedHours: 1,
        },
      ],
    },
    {
      date: '2026-05-12',
      totalMinutes: 240,
      goalMinutes: 480,
      categories: [
        {
          categoryId: 1,
          name: 'Project Alpha',
          color: '#3366ff',
          workdayCode: 'ALPHA',
          minutes: 120,
          roundedHours: 2,
        },
        {
          categoryId: 2,
          name: 'Support',
          color: '#22aa66',
          workdayCode: null,
          minutes: 120,
          roundedHours: 2,
        },
      ],
    },
  ],
};

describe('weeklyExport helpers', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('builds csv export content with totals', () => {
    const artifact = buildWeeklyExport(weeklySummary, 'csv');

    expect(artifact.filename).toBe('time-keeper-2026-W20.csv');
    expect(artifact.content).toContain('"Category","Workday Code","2026-05-11","2026-05-12","Total"');
    expect(artifact.content).toContain('"Project Alpha","ALPHA","2.00","2.00","4.00"');
    expect(artifact.content).toContain('"Total","","3.00","4.00","7.00"');
  });

  it('builds plain-text and compact summaries', () => {
    const plain = buildWeeklyExport(weeklySummary, 'plain');
    const compact = buildWeeklyExport(weeklySummary, 'compact');

    expect(plain.content).toContain('Time Keeper — Week 2026-W20');
    expect(plain.content).toContain('Project Alpha (ALPHA)');
    expect(plain.content).toContain('Daily totals');

    expect(compact.content).toContain('Week 2026-W20');
    expect(compact.content).toContain('ALPHA: 4.00h');
    expect(compact.content).toContain('Support: 3.00h');
    expect(compact.content).toContain('TOTAL: 7.00h');
  });

  it('persists the last used export format', () => {
    expect(getStoredWeeklyExportFormat()).toBe('csv');
    setStoredWeeklyExportFormat('compact');
    expect(getStoredWeeklyExportFormat()).toBe('compact');
  });
});
