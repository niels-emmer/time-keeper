import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { useTimer } from '@/hooks/useTimer';
import { useCategories } from '@/hooks/useCategories';
import { useRecentCategoryIds } from '@/hooks/useRecentCategories';
import { ActiveTimer } from '@/components/ActiveTimer';
import { CategoryGrid } from '@/components/CategoryGrid';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  filterTrackCategories,
  getStoredPinnedCategoryIds,
  getStoredTrackSortMode,
  setStoredPinnedCategoryIds,
  setStoredTrackSortMode,
  sortTrackCategories,
  togglePinnedCategoryId,
  type TrackSortMode,
} from '@/lib/track';
import type { Category } from '@time-keeper/shared';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

const SORT_MODES: Array<{ value: TrackSortMode; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'recent', label: 'Recent' },
  { value: 'alphabetical', label: 'A–Z' },
];

export function Home() {
  const { data: timerStatus } = useTimer();
  const { data: categories = [] } = useCategories();
  const activeEntry = timerStatus?.active ? timerStatus.entry : undefined;
  const activeCategory = activeEntry
    ? categories.find((category) => category.id === activeEntry.categoryId)
    : undefined;

  const { data: recentCategoryIds = [] } = useRecentCategoryIds(activeEntry);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<TrackSortMode>(() => getStoredTrackSortMode());
  const [pinnedCategoryIds, setPinnedCategoryIds] = useState<number[]>(() => getStoredPinnedCategoryIds());

  useEffect(() => {
    setStoredTrackSortMode(sortMode);
  }, [sortMode]);

  useEffect(() => {
    setStoredPinnedCategoryIds(pinnedCategoryIds);
  }, [pinnedCategoryIds]);

  useEffect(() => {
    setPinnedCategoryIds((current) => current.filter((id) => categories.some((category) => category.id === id)));
  }, [categories]);

  const pinnedSet = useMemo(() => new Set(pinnedCategoryIds), [pinnedCategoryIds]);
  const recentSet = useMemo(() => new Set(recentCategoryIds), [recentCategoryIds]);

  const filteredCategories = useMemo(
    () => filterTrackCategories(categories, searchQuery),
    [categories, searchQuery]
  );

  const searchResults = useMemo(
    () => sortTrackCategories(filteredCategories, sortMode, recentCategoryIds, pinnedCategoryIds),
    [filteredCategories, sortMode, recentCategoryIds, pinnedCategoryIds]
  );

  const pinnedCategories = useMemo(
    () => sortTrackCategories(
      categories.filter((category) => pinnedSet.has(category.id)),
      sortMode,
      recentCategoryIds,
      pinnedCategoryIds
    ),
    [categories, pinnedSet, sortMode, recentCategoryIds, pinnedCategoryIds]
  );

  const recentCategories = useMemo(
    () => recentCategoryIds
      .map((categoryId) => categories.find((category) => category.id === categoryId))
      .filter((category): category is Category => Boolean(category))
      .filter((category) => !pinnedSet.has(category.id)),
    [categories, recentCategoryIds, pinnedSet]
  );

  const remainingCategories = useMemo(
    () => sortTrackCategories(
      categories.filter((category) => !pinnedSet.has(category.id) && !recentSet.has(category.id)),
      sortMode,
      recentCategoryIds,
      []
    ),
    [categories, pinnedSet, recentSet, sortMode, recentCategoryIds]
  );

  const hasSearch = searchQuery.trim().length > 0;
  const hasOrganizedSections = !hasSearch && (pinnedCategories.length > 0 || recentCategories.length > 0);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {activeEntry && activeCategory && (
        <ActiveTimer
          entry={activeEntry}
          categoryName={activeCategory.name}
          categoryColor={activeCategory.color}
        />
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold">Track</h1>
                <p className="text-sm text-muted-foreground">
                  {categories.length} categories · {pinnedCategoryIds.length} pinned
                </p>
              </div>
              {activeCategory && (
                <div className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  Tracking {activeCategory.name}
                </div>
              )}
            </div>
            {/* Description removed as per new UI spec */}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search categories or Workday codes"
              className="pl-9 pr-10"
              aria-label="Search categories"
            />
            {hasSearch && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Sorting buttons removed; recents first, then more, manual sorting only within categories */}

          {activeCategory && (
            <div className="rounded-xl border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Currently tracking:</span> {activeCategory.name}. Tap another category below to switch instantly.
            </div>
          )}
        </CardContent>
      </Card>

      {hasSearch ? (
        <Section
          title={`Results (${searchResults.length})`}
          description="Search results are still sorted using your selected Track mode, with pinned categories first."
        >
          <CategoryGrid
            categories={searchResults}
            activeEntry={activeEntry}
            pinnedCategoryIds={pinnedCategoryIds}
            onTogglePinned={(categoryId) => setPinnedCategoryIds((current) => togglePinnedCategoryId(current, categoryId))}
            emptyTitle="No matching categories"
            emptyDescription={`Nothing matched “${searchQuery.trim()}”. Try a different name or Workday code.`}
          />
        </Section>
      ) : (
        <>
          {pinnedCategories.length > 0 && (
            <Section
              title={`Pinned (${pinnedCategories.length})`}
              description="Your quickest access categories. Tap the pin icon again to remove one from this section."
            >
              <CategoryGrid
                categories={pinnedCategories}
                activeEntry={activeEntry}
                pinnedCategoryIds={pinnedCategoryIds}
                onTogglePinned={(categoryId) => setPinnedCategoryIds((current) => togglePinnedCategoryId(current, categoryId))}
              />
            </Section>
          )}

          {recentCategories.length > 0 && (
            <Section
              title="Recent"
              description="Based on your latest activity across the last two weeks, with the active timer surfaced first."
            >
              <CategoryGrid
                categories={recentCategories}
                activeEntry={activeEntry}
                pinnedCategoryIds={pinnedCategoryIds}
                onTogglePinned={(categoryId) => setPinnedCategoryIds((current) => togglePinnedCategoryId(current, categoryId))}
              />
            </Section>
          )}

          <Section
            title={hasOrganizedSections ? 'More categories' : 'All categories'}
            description={
              sortMode === 'manual'
                ? 'This list follows your saved Settings order.'
                : sortMode === 'recent'
                ? 'Remaining categories keep your less-used items available without burying recent work.'
                : 'Remaining categories are sorted alphabetically for quick scanning.'
            }
          >
            <CategoryGrid
              categories={hasOrganizedSections ? remainingCategories : searchResults}
              activeEntry={activeEntry}
              pinnedCategoryIds={pinnedCategoryIds}
              onTogglePinned={(categoryId) => setPinnedCategoryIds((current) => togglePinnedCategoryId(current, categoryId))}
              emptyTitle="No categories left to show"
              emptyDescription="Everything is already surfaced above in your pinned and recent sections."
            />
          </Section>
        </>
      )}
    </div>
  );
}
