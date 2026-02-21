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
            className="relative flex min-h-[5.5rem] flex-col items-start justify-end rounded-xl border-2 p-4 text-left transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: isActive ? cat.color : 'hsl(var(--border))',
              backgroundColor: isActive ? `${cat.color}18` : 'hsl(var(--card))',
              boxShadow: isActive ? `0 0 0 1px ${cat.color}40, 0 4px 16px ${cat.color}25` : 'none',
            }}
          >
            {/* Pill badge — colour-tinted, shows workday code or first 3 chars of name */}
            <span
              className="absolute left-3 top-3 rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{
                backgroundColor: `${cat.color}28`,
                color: cat.color,
                border: `1px solid ${cat.color}60`,
              }}
            >
              {cat.workdayCode ?? (cat.name.includes(' ')
                ? cat.name.split(' ').map((w: string) => w[0]).join('').toUpperCase()
                : cat.name.slice(0, 2).toUpperCase())}
            </span>
            {/* Active blinking dot — top-right */}
            {isActive && (
              <span
                className="absolute right-3 top-3 inline-block h-2 w-2 animate-pulse rounded-full"
                style={{ backgroundColor: cat.color }}
              />
            )}
            <span className="text-sm font-semibold leading-tight">{cat.name}</span>
          </button>
        );
      })}
    </div>
  );
}
