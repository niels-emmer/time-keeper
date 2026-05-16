import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonthlyFocusCard } from '../MonthlyFocusCard';
import type { MonthlySummary } from '@time-keeper/shared';

const summary: MonthlySummary = {
  monthYear: '2026-05',
  monthLabel: 'May 2026',
  isCurrentMonth: true,
  daysElapsed: 10,
  daysInMonth: 31,
  remainingDays: 21,
  totalActualMinutes: 540,
  totalGoalMinutes: 720,
  billableMinutes: 420,
  nonBillableMinutes: 120,
  categories: [
    {
      categoryId: 1,
      name: 'Project Alpha',
      color: '#3366ff',
      workdayCode: 'ALPHA',
      billable: true,
      actualMinutes: 420,
      goalMinutes: 480,
      expectedMinutesByNow: 160,
      remainingMinutes: 60,
      projectedMinutes: 1302,
      requiredDailyMinutes: 3,
      status: 'on-pace',
    },
    {
      categoryId: 2,
      name: 'Maintenance',
      color: '#22aa66',
      workdayCode: 'MAINT',
      billable: false,
      actualMinutes: 120,
      goalMinutes: 600,
      expectedMinutesByNow: 200,
      remainingMinutes: 480,
      projectedMinutes: 372,
      requiredDailyMinutes: 23,
      status: 'behind',
    },
  ],
};

describe('MonthlyFocusCard', () => {
  it('highlights the categories that need attention most', () => {
    render(<MonthlyFocusCard summary={summary} />);

    expect(screen.getByText('Needs attention')).not.toBeNull();
    expect(screen.getByText('Maintenance')).not.toBeNull();
    expect(screen.getByText(/Need 0\.4h/)).not.toBeNull();
  });
});
