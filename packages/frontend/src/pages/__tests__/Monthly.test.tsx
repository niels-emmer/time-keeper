import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Monthly } from '../Monthly';

const { useMonthlySummaryMock } = vi.hoisted(() => ({
  useMonthlySummaryMock: vi.fn(),
}));

vi.mock('@/hooks/useMonthlySummary', () => ({
  useMonthlySummary: (...args: unknown[]) => useMonthlySummaryMock(...args),
}));

describe('Monthly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Finding M-3: a failed monthly query must not render a blank tab.
  it('shows the error and a Retry that refetches', () => {
    const refetch = vi.fn();
    useMonthlySummaryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Monthly failed'),
      refetch,
    });

    render(<Monthly />);

    expect(screen.getByRole('alert').textContent).toContain('Monthly failed');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps month navigation usable while the query is failing', () => {
    useMonthlySummaryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Monthly failed'),
      refetch: vi.fn(),
    });

    render(<Monthly />);

    expect(screen.getByRole('button', { name: 'Previous month' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Next month' })).not.toBeNull();
  });
});
