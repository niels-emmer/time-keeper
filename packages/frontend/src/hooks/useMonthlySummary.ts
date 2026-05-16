import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useMonthlySummary(monthYear: string) {
  return useQuery({
    queryKey: ['summary', 'monthly', monthYear],
    queryFn: () => api.summary.monthly(monthYear),
  });
}
