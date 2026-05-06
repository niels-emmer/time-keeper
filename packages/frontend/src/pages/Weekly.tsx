import { WeeklySummary } from '@/components/WeeklySummary';
import { MonthlyGoalsCard } from '@/components/MonthlyGoalsCard';

export function Weekly() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <MonthlyGoalsCard />
      <WeeklySummary />
    </div>
  );
}
