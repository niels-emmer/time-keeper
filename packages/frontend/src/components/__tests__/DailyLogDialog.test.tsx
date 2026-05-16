import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyLogDialog } from '../DailyLogDialog';

const {
  useEntriesMock,
  createEntryMutateAsyncMock,
  updateEntryMutateAsyncMock,
  deleteEntryMutateAsyncMock,
  onDateChangeMock,
} = vi.hoisted(() => ({
  useEntriesMock: vi.fn(),
  createEntryMutateAsyncMock: vi.fn(),
  updateEntryMutateAsyncMock: vi.fn(),
  deleteEntryMutateAsyncMock: vi.fn(),
  onDateChangeMock: vi.fn(),
}));

const categories = [
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
    name: 'Support',
    color: '#22aa66',
    workdayCode: null,
    billable: false,
    sortOrder: 1,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
];

vi.mock('@/hooks/useEntries', () => ({
  useEntries: (...args: unknown[]) => useEntriesMock(...args),
  useCreateEntry: () => ({ mutateAsync: createEntryMutateAsyncMock, isPending: false }),
  useUpdateEntry: () => ({ mutateAsync: updateEntryMutateAsyncMock, isPending: false }),
  useDeleteEntry: () => ({ mutateAsync: deleteEntryMutateAsyncMock, isPending: false }),
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategories: () => ({ data: categories }),
}));

describe('DailyLogDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEntriesMock.mockReturnValue({
      data: [
        {
          id: 10,
          userId: 'alice@example.com',
          categoryId: 1,
          startTime: '2026-05-14T09:00:00.000Z',
          endTime: '2026-05-14T10:30:00.000Z',
          notes: 'Worked on backlog cleanup',
          rounded: false,
          createdAt: '2026-05-14T10:30:00.000Z',
          updatedAt: '2026-05-14T10:30:00.000Z',
        },
      ],
      isLoading: false,
    });
    createEntryMutateAsyncMock.mockResolvedValue(undefined);
  });

  it('renders the day summary and actual entries', () => {
    render(
      <DailyLogDialog
        open
        date="2026-05-14"
        onOpenChange={() => undefined}
        onDateChange={onDateChangeMock}
      />
    );

    expect(screen.getByText(/daily log/i)).not.toBeNull();
    expect(screen.getByText('Actual entries')).not.toBeNull();
    expect(screen.getByText('Worked on backlog cleanup')).not.toBeNull();
    expect(screen.getByText('1h 30m')).not.toBeNull();
  });

  it('creates a manual entry from the add-entry dialog', async () => {
    render(
      <DailyLogDialog
        open
        date="2026-05-14"
        onOpenChange={() => undefined}
        onDateChange={onDateChangeMock}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /add entry/i }));

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-05-14T13:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-05-14T14:30' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Backfilled support work' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => {
      expect(createEntryMutateAsyncMock).toHaveBeenCalledWith({
        categoryId: 2,
        startTime: new Date('2026-05-14T13:00').toISOString(),
        endTime: new Date('2026-05-14T14:30').toISOString(),
        notes: 'Backfilled support work',
      });
    });
  });
});
