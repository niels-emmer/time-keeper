import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateEntryDTO, UpdateEntryDTO } from '@time-keeper/shared';

export function useEntries(date: string, enabled = true) {
  return useQuery({
    queryKey: ['entries', 'date', date],
    queryFn: () => api.entries.listByDate(date),
    enabled,
  });
}

function invalidateEntryRelatedQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['entries'] });
  qc.invalidateQueries({ queryKey: ['summary'] });
  qc.invalidateQueries({ queryKey: ['monthEntries'] });
  qc.invalidateQueries({ queryKey: ['categories', 'recent'] });
}

export function useCreateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateEntryDTO) => api.entries.create(dto),
    onSuccess: () => invalidateEntryRelatedQueries(qc),
  });
}

export function useUpdateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: UpdateEntryDTO }) => api.entries.update(id, dto),
    onSuccess: () => invalidateEntryRelatedQueries(qc),
  });
}

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.entries.delete(id),
    onSuccess: () => invalidateEntryRelatedQueries(qc),
  });
}
