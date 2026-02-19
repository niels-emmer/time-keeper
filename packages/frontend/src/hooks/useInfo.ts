import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useInfo() {
  return useQuery({
    queryKey: ['info'],
    queryFn: api.info.get,
    // Static data — no need to refetch unless the window is reopened
    staleTime: Infinity,
  });
}
