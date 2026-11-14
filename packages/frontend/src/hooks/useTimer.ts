import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Poll cadence while a timer is running (keeps the overview chips fresh). */
export const TIMER_POLL_INTERVAL_MS = 5000;

/**
 * Poll only while a timer is active. An idle tab has nothing to refresh, and
 * polling it forever was one of the redundant "now" sources in finding L-11.
 */
export function getTimerRefetchInterval(active: boolean): number | false {
  return active ? TIMER_POLL_INTERVAL_MS : false;
}

export function useTimer() {
  return useQuery({
    queryKey: ['timer'],
    queryFn: api.timer.status,
    refetchInterval: (query) => getTimerRefetchInterval(query.state.data?.active === true),
  });
}

export function useStartTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: number) => api.timer.start(categoryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['categories', 'recent'] });
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
      qc.invalidateQueries({ queryKey: ['categories', 'recent'] });
    },
  });
}
