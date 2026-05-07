import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthlyOverviewCard } from '../MonthlyOverviewCard';

const { mockCategories, apiMock } = vi.hoisted(() => ({
  mockCategories: [
    {
      id: 1,
      userId: 'alice@example.com',
      name: 'Project Alpha',
      color: '#3366ff',
      workdayCode: 'ALPHA',
      billable: true,
      sortOrder: 0,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    },
    {
      id: 2,
      userId: 'alice@example.com',
      name: 'Maintenance',
      color: '#22aa66',
      workdayCode: 'MAINT',
      billable: false,
      sortOrder: 1,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    },
    {
      id: 3,
      userId: 'alice@example.com',
      name: 'Hidden Category',
      color: '#ff9933',
      workdayCode: 'HIDE',
      billable: false,
      sortOrder: 2,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    },
  ],
  apiMock: {
    monthlyGoals: {
      get: vi.fn(),
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

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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

describe('MonthlyOverviewCard', () => {
  beforeEach(() => {
    apiMock.monthlyGoals.get.mockImplementation(async (categoryId: number) => {
      if (categoryId === 1) {
        return { goal: { availableHours: 8, availableMinutes: 0 } };
      }
      if (categoryId === 2) {
        return { goal: { availableHours: 4, availableMinutes: 0 } };
      }
      return { goal: null };
    });

    apiMock.entries.listByWeek.mockResolvedValue([
      {
        id: 1,
        categoryId: 1,
        ...isoAtDayOffset(-1, 8, 10),
      },
      {
        id: 2,
        categoryId: 2,
        ...isoAtDayOffset(0, 11, 12),
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows only categories with goals or actual hours and uses workday codes', async () => {
    renderWithClient(<MonthlyOverviewCard />);

    expect(await screen.findByText('Projected vs Actual Hours by Category')).not.toBeNull();
    expect(screen.getByText('ALPHA')).not.toBeNull();
    expect(screen.getByText('MAINT')).not.toBeNull();
    expect(screen.queryByText('HIDE')).toBeNull();
    expect(screen.getByText('Projected')).not.toBeNull();
    expect(screen.getByText('Actual')).not.toBeNull();
  });

  it('renders the billable breakdown when actual hours exist', async () => {
    renderWithClient(<MonthlyOverviewCard />);

    expect(await screen.findByText('Hours by Type')).not.toBeNull();
    expect(screen.getByText('billable')).not.toBeNull();
    expect(screen.getByText('non billable')).not.toBeNull();
  });
});