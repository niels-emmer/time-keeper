import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useTimer() {
  return useQuery({
    queryKey: ['timer'],
    queryFn: api.timer.status,
    refetchInterval: 5000, // poll every 5s to keep elapsed time fresh
  });
}

export function useStartTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: number) => api.timer.start(categoryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
    },
  });
}

export function useStopTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.timer.stop,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
    },
  });
}
