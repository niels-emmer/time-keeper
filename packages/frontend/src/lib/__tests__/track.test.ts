import { describe, expect, it } from 'vitest';
import {
  deriveRecentCategoryIds,
  filterTrackCategories,
  sortTrackCategories,
  togglePinnedCategoryId,
  type TrackSortMode,
} from '../track';
import type { Category, TimeEntry } from '@time-keeper/shared';

const categories: Category[] = [
  {
    id: 1,
    userId: 'alice@example.com',
    name: 'Project Alpha',
    color: '#3366ff',
    workdayCode: 'ALPHA',
    billable: true,
    sortOrder: 0,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 2,
    userId: 'alice@example.com',
    name: 'Bug Bash',
    color: '#ff6633',
    workdayCode: 'BUGS',
    billable: false,
    sortOrder: 1,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 3,
    userId: 'alice@example.com',
    name: 'Customer Support',
    color: '#22aa66',
    workdayCode: null,
    billable: false,
    sortOrder: 2,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
];

const entries: TimeEntry[] = [
  {
    id: 11,
    userId: 'alice@example.com',
    categoryId: 2,
    startTime: '2026-05-10T08:00:00.000Z',
    endTime: '2026-05-10T09:00:00.000Z',
    notes: null,
    rounded: false,
    createdAt: '2026-05-10T08:00:00.000Z',
    updatedAt: '2026-05-10T09:00:00.000Z',
  },
  {
    id: 12,
    userId: 'alice@example.com',
    categoryId: 1,
    startTime: '2026-05-12T10:00:00.000Z',
    endTime: '2026-05-12T11:00:00.000Z',
    notes: null,
    rounded: false,
    createdAt: '2026-05-12T10:00:00.000Z',
    updatedAt: '2026-05-12T11:00:00.000Z',
  },
  {
    id: 13,
    userId: 'alice@example.com',
    categoryId: 3,
    startTime: '2026-05-09T12:00:00.000Z',
    endTime: '2026-05-09T13:00:00.000Z',
    notes: null,
    rounded: false,
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T13:00:00.000Z',
  },
];

function sortedNames(mode: TrackSortMode, pinned: number[] = []) {
  return sortTrackCategories(categories, mode, [1, 2, 3], pinned).map((category) => category.name);
}

describe('track helpers', () => {
  it('filters by category name and Workday code', () => {
    expect(filterTrackCategories(categories, 'project').map((category) => category.id)).toEqual([1]);
    expect(filterTrackCategories(categories, 'bugs').map((category) => category.id)).toEqual([2]);
  });

  it('derives recent categories from latest activity and active timer', () => {
    expect(deriveRecentCategoryIds(entries)).toEqual([1, 2, 3]);
    expect(deriveRecentCategoryIds(entries, { ...entries[2], categoryId: 3, endTime: null })).toEqual([3, 1, 2]);
  });

  it('sorts categories by the selected mode while keeping pins first', () => {
    expect(sortedNames('manual')).toEqual(['Project Alpha', 'Bug Bash', 'Customer Support']);
    expect(sortedNames('alphabetical')).toEqual(['Bug Bash', 'Customer Support', 'Project Alpha']);
    expect(sortedNames('recent')).toEqual(['Project Alpha', 'Bug Bash', 'Customer Support']);
    expect(sortedNames('alphabetical', [3])).toEqual(['Customer Support', 'Bug Bash', 'Project Alpha']);
  });

  it('toggles pinned ids without duplicates', () => {
    expect(togglePinnedCategoryId([], 2)).toEqual([2]);
    expect(togglePinnedCategoryId([2], 2)).toEqual([]);
    expect(togglePinnedCategoryId([2, 2], 1).sort((left, right) => left - right)).toEqual([1, 2]);
  });
});
