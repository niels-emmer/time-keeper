import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryGrid } from '../CategoryGrid';
import type { Category, TimeEntry } from '@time-keeper/shared';

const { startTimerMock } = vi.hoisted(() => ({
  startTimerMock: {
    mutate: vi.fn(),
    isPending: false,
  },
}));

vi.mock('@/hooks/useTimer', () => ({
  useStartTimer: () => startTimerMock,
}));

const categories: Category[] = [
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
    name: 'Internal Ops',
    color: '#ff6633',
    workdayCode: null,
    billable: false,
    sortOrder: 1,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
];

const activeEntry: TimeEntry = {
  id: 10,
  userId: 'alice@example.com',
  categoryId: 1,
  startTime: '2026-05-13T09:00:00.000Z',
  endTime: null,
  notes: null,
  rounded: false,
  createdAt: '2026-05-13T09:00:00.000Z',
  updatedAt: '2026-05-13T09:00:00.000Z',
};

describe('CategoryGrid', () => {
  beforeEach(() => {
    startTimerMock.mutate.mockClear();
  });

  it('shows active and pinned states', () => {
    render(
      <CategoryGrid
        categories={categories}
        activeEntry={activeEntry}
        pinnedCategoryIds={[2]}
        onTogglePinned={() => undefined}
      />
    );

    expect(screen.getByText('Now tracking')).not.toBeNull();
    expect(screen.getByText('pinned')).not.toBeNull();
  });

  it('starts a timer when a category card is pressed', () => {
    render(<CategoryGrid categories={categories} pinnedCategoryIds={[]} onTogglePinned={() => undefined} />);

    fireEvent.click(screen.getByText('Project Alpha').closest('button')!);

    expect(startTimerMock.mutate).toHaveBeenCalledWith(1);
  });

  it('toggles pin state without starting the timer', () => {
    const onTogglePinned = vi.fn();

    render(
      <CategoryGrid
        categories={categories}
        pinnedCategoryIds={[]}
        onTogglePinned={onTogglePinned}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /pin internal ops/i }));

    expect(onTogglePinned).toHaveBeenCalledWith(2);
    expect(startTimerMock.mutate).not.toHaveBeenCalledWith(2);
  });
});
