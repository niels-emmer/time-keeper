import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MonthlyOverviewCard } from '../MonthlyOverviewCard';
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
      goalMinutes: 240,
      expectedMinutesByNow: 80,
      remainingMinutes: 120,
      projectedMinutes: 372,
      requiredDailyMinutes: 6,
      status: 'behind',
    },
  ],
};

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ data, children }: { data: Array<{ name: string }>; children: React.ReactNode }) => (
    <div>
      {data.map((item) => (
        <span key={item.name}>{item.name}</span>
      ))}
      {children}
    </div>
  ),
  Bar: ({ name, dataKey }: { name?: string; dataKey?: string }) => <div>{name ?? dataKey}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Cell: () => null,
}));

describe('MonthlyOverviewCard', () => {
  it('renders monthly headline metrics and chart labels', async () => {
    render(<MonthlyOverviewCard summary={summary} />);

    expect(screen.getByText('Monthly Overview — May 2026')).not.toBeNull();
    expect(screen.getByText('Tracked so far')).not.toBeNull();
    expect(screen.getByText('9.0h')).not.toBeNull();
    expect(screen.getByText('ALPHA')).not.toBeNull();
    expect(screen.getByText('MAINT')).not.toBeNull();
    expect(screen.getByText('Goal')).not.toBeNull();
    expect(screen.getByText('Actual')).not.toBeNull();
  });

  it('renders the billable breakdown when monthly hours exist', async () => {
    render(<MonthlyOverviewCard summary={summary} />);

    expect(screen.getByText('Hours by Type')).not.toBeNull();
    expect(screen.getByText('billable')).not.toBeNull();
    expect(screen.getByText('non billable')).not.toBeNull();
  });
});
