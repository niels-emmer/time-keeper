import { useTimer } from '@/hooks/useTimer';
import { useCategories } from '@/hooks/useCategories';
import { CategoryGrid } from '@/components/CategoryGrid';
import { ActiveTimer } from '@/components/ActiveTimer';

export function Home() {
  const { data: timerStatus } = useTimer();
  const { data: categories = [] } = useCategories();

  // The SW owns the notification lifecycle and polls /api/timer independently.
  // No page-side notification management needed here.

  const activeEntry = timerStatus?.active ? timerStatus.entry : undefined;
  const activeCategory = activeEntry
    ? categories.find((c) => c.id === activeEntry.categoryId)
    : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {activeEntry && activeCategory && (
        <ActiveTimer
          entry={activeEntry}
          categoryName={activeCategory.name}
          categoryColor={activeCategory.color}
        />
      )}
      <CategoryGrid categories={categories} activeEntry={activeEntry} />
    </div>
  );
}
