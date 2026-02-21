import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toISOWeek } from '@time-keeper/shared';

export function useWeeklySummary(week?: string) {
  const weekKey = week ?? toISOWeek(new Date());
  return useQuery({
    queryKey: ['summary', 'weekly', weekKey],
    queryFn: () => api.summary.weekly(weekKey),
  });
}

export function useRoundDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => api.summary.round(date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
    },
  });
}

export function useRoundWeek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (week: string) => api.summary.roundWeek(week),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
    },
  });
}
