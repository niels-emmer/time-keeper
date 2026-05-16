import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WeeklySummary } from '../WeeklySummary';

const { useWeeklySummaryMock, roundWeekMutateMock, adjustCellMutateAsyncMock, clipboardWriteTextMock } = vi.hoisted(() => ({
  useWeeklySummaryMock: vi.fn(),
  roundWeekMutateMock: vi.fn(),
  adjustCellMutateAsyncMock: vi.fn(),
  clipboardWriteTextMock: vi.fn(async () => undefined),
}));

vi.mock('@/hooks/useSummary', () => ({
  useWeeklySummary: (...args: unknown[]) => useWeeklySummaryMock(...args),
  useRoundWeek: () => ({ mutate: roundWeekMutateMock, isPending: false }),
  useAdjustCell: () => ({ mutateAsync: adjustCellMutateAsyncMock, isPending: false }),
}));

vi.mock('@/components/DailyLogDialog', () => ({
  DailyLogDialog: () => null,
}));

const summary = {
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

describe('WeeklySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useWeeklySummaryMock.mockReturnValue({ data: summary, isLoading: false });
    Object.assign(globalThis.navigator, {
      clipboard: {
        writeText: clipboardWriteTextMock,
      },
    });
  });

  it('renders export preview and lets the user switch formats', async () => {
    render(<WeeklySummary />);

    expect(screen.getByText('Review this week before you submit')).not.toBeNull();
    expect((screen.getByLabelText('Weekly export preview') as HTMLTextAreaElement).value).toContain('"Category"');

    fireEvent.click(screen.getByRole('button', { name: 'Plain text' }));

    await waitFor(() => {
      expect((screen.getByLabelText('Weekly export preview') as HTMLTextAreaElement).value).toContain('Time Keeper — Week 2026-W20');
    });
  });

  it('copies the selected export preview', async () => {
    render(<WeeklySummary />);

    fireEvent.click(screen.getByRole('button', { name: /copy csv/i }));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('"Category"'));
    });
  });
});
