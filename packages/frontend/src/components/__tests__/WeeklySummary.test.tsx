import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isoWeekBounds } from '@time-keeper/shared';
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
  // WeeklySummary now reads categories from React Query (the "Add category"
  // picker), so it needs a provider even though these two tests never open it.
  function renderWithClient(ui: React.ReactElement) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  }

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
    renderWithClient(<WeeklySummary />);

    expect(screen.getByText('Review this week before you submit')).not.toBeNull();
    expect((screen.getByLabelText('Weekly export preview') as HTMLTextAreaElement).value).toContain('"Category"');

    fireEvent.click(screen.getByRole('button', { name: 'Plain text' }));

    await waitFor(() => {
      expect((screen.getByLabelText('Weekly export preview') as HTMLTextAreaElement).value).toContain('Time Keeper — Week 2026-W20');
    });
  });

  it('copies the selected export preview', async () => {
    renderWithClient(<WeeklySummary />);

    fireEvent.click(screen.getByRole('button', { name: /copy csv/i }));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('"Category"'));
    });
  });

  // Finding M-3: a failed query used to render a blank Weekly tab.
  it('shows the error and a Retry that refetches when the weekly query fails', () => {
    const refetch = vi.fn();
    useWeeklySummaryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Summary unavailable'),
      refetch,
    });

    renderWithClient(<WeeklySummary />);

    expect(screen.getByRole('alert').textContent).toContain('Summary unavailable');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // Finding L-10: navigation must use the shared ISO-week math and stay Mon–Sun.
  it('navigates one week at a time and keeps Monday–Sunday bounds', () => {
    renderWithClient(<WeeklySummary />);

    const initialWeek = screen.getByText(/^\d{4}-W\d{2}$/).textContent!;

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));

    const nextWeek = screen.getByText(/^\d{4}-W\d{2}$/).textContent!;

    expect(nextWeek).not.toBe(initialWeek);
    expect(useWeeklySummaryMock).toHaveBeenLastCalledWith(nextWeek);

    const initialBounds = isoWeekBounds(initialWeek);
    const nextBounds = isoWeekBounds(nextWeek);

    expect(initialBounds.start.getUTCDay()).toBe(1);
    expect(initialBounds.end.getUTCDay()).toBe(0);
    expect(nextBounds.start.getUTCDay()).toBe(1);
    expect(nextBounds.end.getUTCDay()).toBe(0);
    expect((nextBounds.start.getTime() - initialBounds.start.getTime()) / 86_400_000).toBe(7);
  });

  // Finding M-3: a failed cell save must not silently revert the optimistic edit.
  it('surfaces a cell-save error instead of silently reverting', async () => {
    adjustCellMutateAsyncMock.mockRejectedValueOnce(new Error('Adjust failed'));

    renderWithClient(<WeeklySummary />);

    fireEvent.click(screen.getAllByText('2.0h')[0]);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Adjust failed');
    });
  });
});
