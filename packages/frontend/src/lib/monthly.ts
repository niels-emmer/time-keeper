import type { CategoryTargetCadence, MonthlyCategoryStatus, MonthlySummary } from '@time-keeper/shared';

export function getCurrentMonthYear() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(monthYear: string, offset: number) {
  const [yearStr, monthStr] = monthYear.split('-');
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatHoursFromMinutes(minutes: number, digits = 1) {
  return `${(minutes / 60).toFixed(digits)}h`;
}

export function getMonthlyStatusMeta(status: MonthlyCategoryStatus) {
  switch (status) {
    case 'over-target':
      return {
        label: 'Over target',
        className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      };
    case 'behind':
      return {
        label: 'Behind',
        className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      };
    case 'no-goal':
      return {
        label: 'No target',
        className: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
    case 'on-pace':
    default:
      return {
        label: 'On pace',
        className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
      };
  }
}

export function getTargetCadenceLabel(targetCadence: CategoryTargetCadence | null) {
  switch (targetCadence) {
    case 'monthly':
      return 'Monthly';
    case 'weekly':
      return 'Weekly';
    case 'one_time':
      return 'One-time';
    default:
      return 'No target';
  }
}

export function getFocusCategories(summary: MonthlySummary) {
  return [...summary.categories]
    .filter((category) => category.goalMinutes > 0 || category.actualMinutes > 0)
    .sort((left, right) => {
      const score = (category: MonthlySummary['categories'][number]) => {
        switch (category.status) {
          case 'behind':
            return 3_000 + (category.remainingMinutes - category.progressMinutes);
          case 'over-target':
            return 2_000 + (category.progressMinutes - category.goalMinutes);
          case 'no-goal':
            return 1_000 + category.actualMinutes;
          case 'on-pace':
          default:
            return category.targetCadence === 'one_time'
              ? Math.max(category.goalMinutes - category.progressMinutes, 0)
              : category.remainingMinutes;
        }
      };
      return score(right) - score(left);
    })
    .slice(0, 3);
}
