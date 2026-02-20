import { CategoryManager } from '@/components/CategoryManager';
import { WeeklyGoalSetting } from '@/components/WeeklyGoalSetting';
import { AboutSection } from '@/components/AboutSection';

export function Settings() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <CategoryManager />
      <WeeklyGoalSetting />
      <AboutSection />
    </div>
  );
}
