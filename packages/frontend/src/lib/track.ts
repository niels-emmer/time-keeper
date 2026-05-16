import type { Category, TimeEntry } from '@time-keeper/shared';

export type TrackSortMode = 'manual' | 'alphabetical' | 'recent';

const TRACK_SORT_MODE_KEY = 'time-keeper-track-sort-mode';
const TRACK_PINNED_KEY = 'time-keeper-track-pinned-category-ids';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function dedupeIds(ids: number[]) {
  return Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
}

export function getStoredTrackSortMode(): TrackSortMode {
  if (!canUseStorage()) return 'manual';

  const value = window.localStorage.getItem(TRACK_SORT_MODE_KEY);
  if (value === 'manual' || value === 'alphabetical' || value === 'recent') {
    return value;
  }

  return 'manual';
}

export function setStoredTrackSortMode(mode: TrackSortMode) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(TRACK_SORT_MODE_KEY, mode);
}

export function getStoredPinnedCategoryIds(): number[] {
  if (!canUseStorage()) return [];

  try {
    const value = window.localStorage.getItem(TRACK_PINNED_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return dedupeIds(parsed.map((item) => Number(item)));
  } catch {
    return [];
  }
}

export function setStoredPinnedCategoryIds(ids: number[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(TRACK_PINNED_KEY, JSON.stringify(dedupeIds(ids)));
}

export function togglePinnedCategoryId(ids: number[], categoryId: number) {
  const set = new Set(dedupeIds(ids));
  if (set.has(categoryId)) {
    set.delete(categoryId);
  } else {
    set.add(categoryId);
  }
  return Array.from(set);
}

export function categoryMatchesTrackQuery(category: Category, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  const haystack = [category.name, category.workdayCode ?? '']
    .join(' ')
    .trim()
    .toLowerCase();

  return haystack.includes(normalized);
}

export function filterTrackCategories(categories: Category[], query: string) {
  if (!query.trim()) return categories;
  return categories.filter((category) => categoryMatchesTrackQuery(category, query));
}

export function deriveRecentCategoryIds(entries: TimeEntry[], activeEntry?: TimeEntry) {
  const latestByCategory = new Map<number, number>();

  for (const entry of entries) {
    const timestamp = new Date(entry.startTime).getTime();
    if (Number.isNaN(timestamp)) continue;

    const current = latestByCategory.get(entry.categoryId) ?? Number.NEGATIVE_INFINITY;
    if (timestamp > current) {
      latestByCategory.set(entry.categoryId, timestamp);
    }
  }

  if (activeEntry) {
    latestByCategory.set(activeEntry.categoryId, Number.POSITIVE_INFINITY);
  }

  return Array.from(latestByCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([categoryId]) => categoryId);
}

export function sortTrackCategories(
  categories: Category[],
  sortMode: TrackSortMode,
  recentCategoryIds: number[],
  pinnedCategoryIds: number[]
) {
  const recentRank = new Map(recentCategoryIds.map((id, index) => [id, index]));
  const manualRank = new Map(categories.map((category, index) => [category.id, index]));
  const pinnedSet = new Set(pinnedCategoryIds);

  return [...categories].sort((left, right) => {
    const leftPinned = pinnedSet.has(left.id);
    const rightPinned = pinnedSet.has(right.id);
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }

    if (sortMode === 'alphabetical') {
      const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      if (byName !== 0) return byName;
    }

    if (sortMode === 'recent') {
      const leftRecent = recentRank.get(left.id);
      const rightRecent = recentRank.get(right.id);
      const leftHasRecent = leftRecent !== undefined;
      const rightHasRecent = rightRecent !== undefined;

      if (leftHasRecent && rightHasRecent && leftRecent !== rightRecent) {
        return leftRecent - rightRecent;
      }
      if (leftHasRecent !== rightHasRecent) {
        return leftHasRecent ? -1 : 1;
      }
    }

    return (manualRank.get(left.id) ?? 0) - (manualRank.get(right.id) ?? 0);
  });
}
