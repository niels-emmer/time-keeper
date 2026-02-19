import { CategoryManager } from '@/components/CategoryManager';
import { AboutSection } from '@/components/AboutSection';

export function Settings() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <CategoryManager />
      <AboutSection />
    </div>
  );
}
