import { describe, expect, it } from 'vitest';
import { buildMonthlySummaryData } from './summaryService.js';

describe('buildMonthlySummaryData', () => {
  it('computes monthly and weekly-derived target status, pace, and billable totals', () => {
    const summary = buildMonthlySummaryData({
      monthYear: '2026-05',
      monthLabel: 'May 2026',
      monthStart: '2026-05-01T00:00:00.000Z',
      monthEnd: '2026-05-31T23:59:59.999Z',
      daysElapsed: 10,
      daysInMonth: 31,
      categories: [
        {
          id: 1,
          name: 'Project Alpha',
          color: '#3366ff',
          workdayCode: 'ALPHA',
          billable: true,
          sortOrder: 0,
          targetCadence: 'monthly',
          targetMinutes: 20 * 60,
          targetStartedAt: null,
        },
        {
          id: 2,
          name: 'Operations',
          color: '#22aa66',
          workdayCode: null,
          billable: false,
          sortOrder: 1,
          targetCadence: 'weekly',
          targetMinutes: 8 * 60,
          targetStartedAt: null,
        },
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
    expect(summary.categories[0].projectedMinutes).toBe(1860);
    expect(summary.categories[1].status).toBe('behind');
    expect(summary.categories[1].goalMinutes).toBe(Math.round(8 * 60 * (31 / 7)));
    expect(summary.categories[1].requiredDailyMinutes).toBeGreaterThan(0);
  });

  it('marks categories with no target and monthly overruns appropriately', () => {
    const summary = buildMonthlySummaryData({
      monthYear: '2026-05',
      monthLabel: 'May 2026',
      monthStart: '2026-05-01T00:00:00.000Z',
      monthEnd: '2026-05-31T23:59:59.999Z',
      daysElapsed: 15,
      daysInMonth: 31,
      categories: [
        {
          id: 1,
          name: 'No Target Work',
          color: '#3366ff',
          workdayCode: null,
          billable: false,
          sortOrder: 0,
          targetCadence: null,
          targetMinutes: null,
          targetStartedAt: null,
        },
        {
          id: 2,
          name: 'Overrun',
          color: '#22aa66',
          workdayCode: 'OVR',
          billable: true,
          sortOrder: 1,
          targetCadence: 'monthly',
          targetMinutes: 5 * 60,
          targetStartedAt: null,
        },
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
    expect(summary.categories[1].remainingMinutes).toBeLessThan(0);
  });

  it('treats one-time targets as non-renewing budgets across months', () => {
    const summary = buildMonthlySummaryData({
      monthYear: '2026-05',
      monthLabel: 'May 2026',
      monthStart: '2026-05-01T00:00:00.000Z',
      monthEnd: '2026-05-31T23:59:59.999Z',
      daysElapsed: 31,
      daysInMonth: 31,
      categories: [
        {
          id: 1,
          name: 'Health Check',
          color: '#8844ff',
          workdayCode: 'HC',
          billable: true,
          sortOrder: 0,
          targetCadence: 'one_time',
          targetMinutes: 10 * 60,
          targetStartedAt: '2026-04-20T00:00:00.000Z',
        },
      ],
      entries: [
        {
          categoryId: 1,
          startTime: '2026-04-25T08:00:00.000Z',
          endTime: '2026-04-25T12:00:00.000Z',
        },
        {
          categoryId: 1,
          startTime: '2026-05-03T08:00:00.000Z',
          endTime: '2026-05-03T15:00:00.000Z',
        },
      ],
    });

    expect(summary.categories[0].actualMinutes).toBe(420);
    expect(summary.categories[0].progressMinutes).toBe(660);
    expect(summary.categories[0].goalMinutes).toBe(600);
    expect(summary.categories[0].status).toBe('over-target');
    expect(summary.categories[0].remainingMinutes).toBe(-60);
  });
});
