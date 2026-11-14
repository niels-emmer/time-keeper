import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Home } from '../Home';

const { useCategoriesMock, useTimerMock, useRecentCategoryIdsMock } = vi.hoisted(() => ({
  useCategoriesMock: vi.fn(),
  useTimerMock: vi.fn(),
  useRecentCategoryIdsMock: vi.fn(),
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategories: (...args: unknown[]) => useCategoriesMock(...args),
}));

vi.mock('@/hooks/useTimer', () => ({
  useTimer: (...args: unknown[]) => useTimerMock(...args),
  useStartTimer: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useRecentCategories', () => ({
  useRecentCategoryIds: (...args: unknown[]) => useRecentCategoryIdsMock(...args),
}));

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTimerMock.mockReturnValue({ data: { active: false } });
    useRecentCategoryIdsMock.mockReturnValue({ data: [] });
  });

  // Finding M-3: a failed categories query must not render an empty Track tab.
  it('shows the error and a Retry that refetches categories', () => {
    const refetch = vi.fn();
    useCategoriesMock.mockReturnValue({
      data: [],
      isFetched: true,
      isLoading: false,
      isError: true,
      error: new Error('Categories failed'),
      refetch,
    });

    render(<Home />);

    expect(screen.getByRole('alert').textContent).toContain('Categories failed');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state until categories arrive', () => {
    useCategoriesMock.mockReturnValue({
      data: [],
      isFetched: false,
      isLoading: true,
      isError: false,
    });

    render(<Home />);

    expect(screen.getByText('Loading categories…')).not.toBeNull();
  });
});
