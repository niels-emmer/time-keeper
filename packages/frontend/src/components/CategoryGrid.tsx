import { Pin } from 'lucide-react';
import { useStartTimer } from '@/hooks/useTimer';
import type { Category, TimeEntry } from '@time-keeper/shared';

interface Props {
  categories: Category[];
  activeEntry?: TimeEntry;
  pinnedCategoryIds?: number[];
  onTogglePinned?: (categoryId: number) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

function getCategoryBadge(category: Category) {
  if (category.workdayCode) return category.workdayCode;
  if (category.name.includes(' ')) {
    return category.name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();
  }
  return category.name.slice(0, 2).toUpperCase();
}

export function CategoryGrid({
  categories,
  activeEntry,
  pinnedCategoryIds = [],
  onTogglePinned,
  emptyTitle = 'No categories yet.',
  emptyDescription = 'Add categories in Settings to start tracking time.',
}: Props) {
  const start = useStartTimer();
  const pinnedSet = new Set(pinnedCategoryIds);

  if (categories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center text-muted-foreground">
        <p className="text-lg">{emptyTitle}</p>
        <p className="mt-1 text-sm">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {categories.map((category) => {
        const isActive = activeEntry?.categoryId === category.id;
        const isPinned = pinnedSet.has(category.id);

        return (
          <div key={category.id} className="relative">
            <button
              onClick={() => start.mutate(category.id)}
              disabled={start.isPending}
              className="relative flex min-h-[6.5rem] w-full flex-col items-start justify-between overflow-hidden rounded-2xl border-2 p-4 pr-12 text-left transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: isActive ? category.color : 'hsl(var(--border))',
                backgroundColor: isActive ? `${category.color}16` : 'hsl(var(--card))',
                boxShadow: isActive
                  ? `0 0 0 1px ${category.color}35, 0 10px 30px ${category.color}20`
                  : '0 4px 16px rgba(15, 23, 42, 0.04)',
              }}
              aria-pressed={isActive}
            >
              <div className="w-full space-y-2.5">
                <span
                  className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{
                    backgroundColor: `${category.color}22`,
                    color: category.color,
                    border: `1px solid ${category.color}55`,
                  }}
                >
                  {getCategoryBadge(category)}
                </span>

                <span className="block min-w-0 line-clamp-2 text-sm font-semibold leading-tight">{category.name}</span>
              </div>

              <div className="flex min-h-[1.5rem] w-full items-end justify-between gap-2 text-xs">
                {isActive ? (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-medium"
                    style={{
                      backgroundColor: `${category.color}20`,
                      color: category.color,
                    }}
                  >
                    <span
                      className="inline-block h-2 w-2 animate-pulse rounded-full"
                      style={{ backgroundColor: category.color }}
                    />
                    Now tracking
                  </span>
                ) : (
                  <span />
                )}

                <div className="flex flex-wrap justify-end gap-1.5">
                  {isPinned && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      pinned
                    </span>
                  )}
                  {category.billable && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      billable
                    </span>
                  )}
                </div>
              </div>
            </button>

            {onTogglePinned && (
              <button
                type="button"
                className="absolute right-3 top-3 rounded-full border bg-background/90 p-1.5 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePinned(category.id);
                }}
                aria-label={isPinned ? `Unpin ${category.name}` : `Pin ${category.name}`}
                aria-pressed={isPinned}
                title={isPinned ? 'Unpin category' : 'Pin category'}
              >
                <Pin
                  className={`h-3.5 w-3.5 ${isPinned ? 'fill-current text-foreground' : ''}`}
                  style={isPinned ? { color: category.color } : undefined}
                />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
