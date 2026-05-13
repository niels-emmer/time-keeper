import { describe, expect, it } from 'vitest';
import { buildMonthlySummaryData } from './summaryService.js';

describe('buildMonthlySummaryData', () => {
  it('computes monthly status, pace, and billable totals', () => {
    const summary = buildMonthlySummaryData({
      monthYear: '2026-05',
      monthLabel: 'May 2026',
      daysElapsed: 10,
      daysInMonth: 20,
      categories: [
        {
          id: 1,
          name: 'Project Alpha',
          color: '#3366ff',
          workdayCode: 'ALPHA',
          billable: true,
          sortOrder: 0,
        },
        {
          id: 2,
          name: 'Operations',
          color: '#22aa66',
          workdayCode: null,
          billable: false,
          sortOrder: 1,
        },
      ],
      goals: [
        { categoryId: 1, availableHours: 20, availableMinutes: 0 },
        { categoryId: 2, availableHours: 8, availableMinutes: 0 },
      ],
      entries: [
        {
          categoryId: 1,
          startTime: '2026-05-01T08:00:00.000Z',
          endTime: '2026-05-01T18:00:00.000Z',
        },
        {
          categoryId: 2,
          startTime: '2026-05-02T08:00:00.000Z',
          endTime: '2026-05-02T10:00:00.000Z',
        },
      ],
    });

    expect(summary.totalActualMinutes).toBe(720);
    expect(summary.billableMinutes).toBe(600);
    expect(summary.nonBillableMinutes).toBe(120);
    expect(summary.categories[0].status).toBe('on-pace');
    expect(summary.categories[0].projectedMinutes).toBe(1200);
    expect(summary.categories[1].status).toBe('behind');
    expect(summary.categories[1].requiredDailyMinutes).toBeGreaterThan(0);
  });

  it('marks categories with no goal and over-target work appropriately', () => {
    const summary = buildMonthlySummaryData({
      monthYear: '2026-05',
      monthLabel: 'May 2026',
      daysElapsed: 15,
      daysInMonth: 30,
      categories: [
        {
          id: 1,
          name: 'No Goal Work',
          color: '#3366ff',
          workdayCode: null,
          billable: false,
          sortOrder: 0,
        },
        {
          id: 2,
          name: 'Overrun',
          color: '#22aa66',
          workdayCode: 'OVR',
          billable: true,
          sortOrder: 1,
        },
      ],
      goals: [
        { categoryId: 2, availableHours: 5, availableMinutes: 0 },
      ],
      entries: [
        {
          categoryId: 1,
          startTime: '2026-05-05T08:00:00.000Z',
          endTime: '2026-05-05T10:00:00.000Z',
        },
        {
          categoryId: 2,
          startTime: '2026-05-06T08:00:00.000Z',
          endTime: '2026-05-06T15:00:00.000Z',
        },
      ],
    });

    expect(summary.categories[0].status).toBe('no-goal');
    expect(summary.categories[1].status).toBe('over-target');
    expect(summary.categories[1].remainingMinutes).toBe(0);
  });
});
