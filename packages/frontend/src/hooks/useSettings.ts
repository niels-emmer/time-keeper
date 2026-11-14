import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type SettingsPayload } from '@/lib/api';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: SettingsPayload) => api.settings.update(settings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
    },
  });
}
