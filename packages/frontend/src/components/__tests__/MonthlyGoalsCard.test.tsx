import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthlyGoalsCard } from '../MonthlyGoalsCard';
import type { MonthlySummary } from '@time-keeper/shared';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    monthlyGoals: {
      set: vi.fn(),
    },
  },
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
  AuthError: class AuthError extends Error {},
}));

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
  ],
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('MonthlyGoalsCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows progress, status, and pace guidance', async () => {
    renderWithClient(<MonthlyGoalsCard summary={summary} />);

    expect(screen.getByText('Project Alpha')).not.toBeNull();
    expect(screen.getByText('On pace')).not.toBeNull();
    expect(screen.getByText('Actual: 7.0h')).not.toBeNull();
    expect(screen.getByText('Goal: 8.0h')).not.toBeNull();
  });

  it('opens the editor and saves an updated monthly goal for the selected month', async () => {
    apiMock.monthlyGoals.set.mockResolvedValue({ goal: { availableHours: 10, availableMinutes: 30 } });

    renderWithClient(<MonthlyGoalsCard summary={summary} />);

    fireEvent.click(screen.getByRole('button', { name: /project alpha/i }));

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '10' } });
    fireEvent.change(inputs[1], { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(apiMock.monthlyGoals.set).toHaveBeenCalledWith({
        categoryId: 1,
        monthYear: '2026-05',
        availableHours: 10,
        availableMinutes: 30,
      });
    });
  });
});
