import { MonthlyOverviewCard } from '@/components/MonthlyOverviewCard';
import { MonthlyGoalsCard } from '@/components/MonthlyGoalsCard';

export function Monthly() {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <MonthlyOverviewCard />
      <MonthlyGoalsCard />
    </div>
  );
}
