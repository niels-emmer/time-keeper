import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toISOWeek } from '@time-keeper/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthlyGoalsCard } from '../MonthlyGoalsCard';

const { mockCategories, apiMock } = vi.hoisted(() => ({
  mockCategories: [
    {
      id: 1,
      userId: 'alice@example.com',
      name: 'Project Alpha',
      color: '#3366ff',
      workdayCode: 'ALPHA',
      bonus: true,
      sortOrder: 0,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    },
  ],
  apiMock: {
    monthlyGoals: {
      get: vi.fn(),
      set: vi.fn(),
    },
    entries: {
      listByWeek: vi.fn(),
    },
  },
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategories: () => ({ data: mockCategories }),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
  AuthError: class AuthError extends Error {},
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function currentMonthYear() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function isoAtDayOffset(days: number, startHour: number, endHour: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);

  const start = new Date(date);
  start.setHours(startHour, 0, 0, 0);

  const end = new Date(date);
  end.setHours(endHour, 0, 0, 0);

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

describe('MonthlyGoalsCard', () => {
  beforeEach(() => {
    const relevantEntries = [
      {
        id: 1,
        categoryId: 1,
        ...isoAtDayOffset(-1, 8, 9),
      },
      {
        id: 2,
        categoryId: 1,
        ...isoAtDayOffset(0, 10, 11),
      },
    ];
    const relevantWeek = toISOWeek(new Date(relevantEntries[0].startTime));

    apiMock.monthlyGoals.get.mockResolvedValue({
      goal: { availableHours: 8, availableMinutes: 0 },
    });
    apiMock.monthlyGoals.set.mockResolvedValue({
      goal: { availableHours: 10, availableMinutes: 30 },
    });
    apiMock.entries.listByWeek.mockImplementation(async (week: string) =>
      week === relevantWeek ? relevantEntries : []
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows month-to-date hours against the saved goal', async () => {
    renderWithClient(<MonthlyGoalsCard />);

    expect(await screen.findByText('Project Alpha')).not.toBeNull();
    expect(await screen.findByText('2.0h / 8h')).not.toBeNull();
  });

  it('opens the editor and saves updated monthly goal values', async () => {
    renderWithClient(<MonthlyGoalsCard />);

    fireEvent.click(await screen.findByRole('button', { name: /project alpha/i }));

    expect(await screen.findByText('Edit Monthly Goal — Project Alpha')).not.toBeNull();

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '10' } });
    fireEvent.change(inputs[1], { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(apiMock.monthlyGoals.set).toHaveBeenCalledWith({
        categoryId: 1,
        monthYear: currentMonthYear(),
        availableHours: 10,
        availableMinutes: 30,
      });
    });
  });
});