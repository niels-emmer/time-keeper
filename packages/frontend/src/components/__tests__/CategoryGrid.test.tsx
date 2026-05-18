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
    targetCadence: null,
    targetMinutes: null,
    targetStartedAt: null,
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
    targetCadence: null,
    targetMinutes: null,
    targetStartedAt: null,
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

  it('shows active state and highlights the active category', () => {
    render(
      <CategoryGrid
        categories={categories}
        activeEntry={activeEntry}
      />
    );

    // Check that the active category card (Project Alpha) is rendered
    const activeCard = screen.getByText('Project Alpha').closest('button');
    expect(activeCard).not.toBeNull();
    
    // Check that old helper text is not shown
    expect(screen.queryByText('Tap to start')).toBeNull();
    expect(screen.queryByText('Tap another category')).toBeNull();
  });

  it('starts a timer when a category card is pressed', () => {
    render(<CategoryGrid categories={categories} />);

    fireEvent.click(screen.getByText('Project Alpha').closest('button')!);

    expect(startTimerMock.mutate).toHaveBeenCalledWith(1);
  });

  it('renders category names and codes in category cards', () => {
    render(<CategoryGrid categories={categories} />);

    expect(screen.getByText('Project Alpha')).not.toBeNull();
    expect(screen.getByText('Internal Ops')).not.toBeNull();
  });
});
