import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryManager } from '../CategoryManager';

const { deleteMutateAsyncMock } = vi.hoisted(() => ({
  deleteMutateAsyncMock: vi.fn(),
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategories: () => ({
    data: [
      {
        id: 1,
        userId: 'alice@example.com',
        name: 'Project Alpha',
        color: '#3366ff',
        workdayCode: null,
        billable: false,
        sortOrder: 0,
        targetCadence: null,
        targetMinutes: null,
        targetStartedAt: null,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    ],
  }),
  useCreateCategory: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCategory: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCategory: () => ({ mutateAsync: deleteMutateAsyncMock, isPending: false }),
  useReorderCategories: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderManager() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CategoryManager />
    </QueryClientProvider>
  );
}

describe('CategoryManager delete confirmation (P2-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for confirmation instead of deleting immediately', async () => {
    renderManager();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Project Alpha' }));

    expect(screen.getByText('Delete category?')).toBeTruthy();
    expect(deleteMutateAsyncMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMutateAsyncMock).toHaveBeenCalledWith(1));
  });

  it('does not delete when the confirmation is cancelled', () => {
    renderManager();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Project Alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteMutateAsyncMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete category?')).toBeNull();
  });

  it('surfaces the 409 message and keeps the dialog open', async () => {
    deleteMutateAsyncMock.mockRejectedValueOnce(
      new Error('Category is used by 3 entries. Reassign or delete them first.')
    );

    renderManager();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Project Alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('used by 3 entries');
    expect(screen.getByText('Delete category?')).toBeTruthy();
  });
});
