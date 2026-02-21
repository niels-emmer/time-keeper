import { useStartTimer } from '@/hooks/useTimer';
import type { Category, TimeEntry } from '@time-keeper/shared';

interface Props {
  categories: Category[];
  activeEntry?: TimeEntry;
}

export function CategoryGrid({ categories, activeEntry }: Props) {
  const start = useStartTimer();

  if (categories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <p className="text-lg">No categories yet.</p>
        <p className="text-sm mt-1">Add categories in Settings to start tracking time.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {categories.map((cat) => {
        const isActive = activeEntry?.categoryId === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => start.mutate(cat.id)}
            disabled={start.isPending}
            className="relative flex min-h-[5.5rem] flex-col items-start justify-end overflow-hidden rounded-xl border p-4 text-left transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: isActive ? cat.color : 'transparent',
              backgroundColor: `${cat.color}1a`, // 10% opacity
            }}
          >
            {/* Left colour stripe */}
            <span
              className="absolute left-0 top-0 h-full w-1.5 rounded-l-xl"
              style={{ backgroundColor: cat.color }}
            />
            {/* Active blinking dot — top-right, unchanged */}
            {isActive && (
              <span
                className="absolute right-3 top-3 inline-block h-2 w-2 animate-pulse rounded-full"
                style={{ backgroundColor: cat.color }}
              />
            )}
            <span className="text-sm font-semibold leading-tight">{cat.name}</span>
            {cat.workdayCode && (
              <span className="mt-0.5 text-xs text-muted-foreground">{cat.workdayCode}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
