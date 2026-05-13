import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { deriveRecentCategoryIds } from '@/lib/track';
import { toISOWeek } from '@time-keeper/shared';
import type { TimeEntry } from '@time-keeper/shared';

function getRelativeWeek(offset: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset * 7);
  return toISOWeek(date);
}

export function useRecentCategoryIds(activeEntry?: TimeEntry) {
  return useQuery({
    queryKey: ['categories', 'recent', activeEntry?.categoryId ?? null],
    queryFn: async () => {
      const [currentWeek, previousWeek] = await Promise.all([
        api.entries.listByWeek(getRelativeWeek(0)),
        api.entries.listByWeek(getRelativeWeek(-1)),
      ]);

      return deriveRecentCategoryIds([...currentWeek, ...previousWeek], activeEntry);
    },
    staleTime: 60_000,
  });
}
