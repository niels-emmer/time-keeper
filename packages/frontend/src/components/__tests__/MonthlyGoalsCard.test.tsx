import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonthlyGoalsCard } from '../MonthlyGoalsCard';
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
      targetCadence: 'weekly',
      actualMinutes: 420,
      progressMinutes: 420,
      goalMinutes: 480,
      expectedMinutesByNow: 160,
      remainingMinutes: 60,
      projectedMinutes: 1302,
      requiredDailyMinutes: 3,
      status: 'on-pace',
    },
    {
      categoryId: 2,
      name: 'Health Check',
      color: '#8844ff',
      workdayCode: 'HC',
      billable: true,
      targetCadence: 'one_time',
      actualMinutes: 180,
      progressMinutes: 660,
      goalMinutes: 600,
      expectedMinutesByNow: 0,
      remainingMinutes: -60,
      projectedMinutes: 720,
      requiredDailyMinutes: 0,
      status: 'over-target',
    },
  ],
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('MonthlyGoalsCard', () => {
  it('shows target status, cadence, and one-time budget overrun details', async () => {
    renderWithClient(<MonthlyGoalsCard summary={summary} />);

    expect(screen.getByText('Project Alpha')).not.toBeNull();
    expect(screen.getByText('Weekly')).not.toBeNull();
    expect(screen.getByText('Target: 8.0h')).not.toBeNull();
    expect(screen.getByText('Health Check')).not.toBeNull();
    expect(screen.getByText('One-time')).not.toBeNull();
    expect(screen.getByText('Spent 11.0h')).not.toBeNull();
    expect(screen.getByText('Overrun 1.0h')).not.toBeNull();
  });

  it('shows an empty-state message when no active targets exist for the month', async () => {
    renderWithClient(
      <MonthlyGoalsCard
        summary={{
          ...summary,
          totalGoalMinutes: 0,
          categories: summary.categories.map((category) => ({ ...category, goalMinutes: 0 })),
        }}
      />
    );

    expect(screen.getByText(/No categories with active targets for this month/i)).not.toBeNull();
  });
});
