import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateCategoryDTO, UpdateCategoryDTO } from '@time-keeper/shared';

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: api.categories.list,
  });
}

function invalidateCategoryDependentQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['categories'] });
  qc.invalidateQueries({ queryKey: ['summary'] });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateCategoryDTO) => api.categories.create(dto),
    onSuccess: () => invalidateCategoryDependentQueries(qc),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: UpdateCategoryDTO }) =>
      api.categories.update(id, dto),
    onSuccess: () => invalidateCategoryDependentQueries(qc),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.categories.delete(id),
    onSuccess: () => invalidateCategoryDependentQueries(qc),
  });
}

export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { id: number; sortOrder: number }[]) => api.categories.reorder(items),
    // Optimistic update is applied by the caller via setQueryData;
    // revalidate on settle to confirm the server state.
    onSettled: () => invalidateCategoryDependentQueries(qc),
  });
}
