import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatHoursFromMinutes, getFocusCategories, getMonthlyStatusMeta, getTargetCadenceLabel } from '@/lib/monthly';
import type { MonthlySummary } from '@time-keeper/shared';

export function MonthlyFocusCard({ summary }: { summary: MonthlySummary }) {
  const focusCategories = getFocusCategories(summary);

  if (focusCategories.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Needs attention</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {focusCategories.map((category) => {
          const statusMeta = getMonthlyStatusMeta(category.status);

          return (
            <div key={category.categoryId} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
                    <span className="font-medium">{category.name}</span>
                    {category.workdayCode && (
                      <span className="text-xs text-muted-foreground">{category.workdayCode}</span>
                    )}
                    {category.targetCadence && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {getTargetCadenceLabel(category.targetCadence)}
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.className}`}>
                      {statusMeta.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {category.status === 'behind' && (
                      <>Behind pace. Need {formatHoursFromMinutes(category.requiredDailyMinutes)} per remaining day to hit the target.</>
                    )}
                    {category.status === 'over-target' && (
                      <>
                        {category.targetCadence === 'one_time'
                          ? `Over budget by ${formatHoursFromMinutes(Math.abs(category.remainingMinutes))}.`
                          : `Already above target by ${formatHoursFromMinutes(Math.abs(category.remainingMinutes))}.`}
                      </>
                    )}
                    {category.status === 'no-goal' && (
                      <>Tracked {formatHoursFromMinutes(category.actualMinutes)} without a target. Edit the category in Settings to add one.</>
                    )}
                    {category.status === 'on-pace' && (
                      <>
                        {category.targetCadence === 'one_time'
                          ? `Budget remaining ${formatHoursFromMinutes(Math.max(category.remainingMinutes, 0))}.`
                          : `On pace with ${formatHoursFromMinutes(Math.max(category.remainingMinutes, 0))} remaining.`}
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right text-sm">
                  {category.targetCadence === 'one_time' ? (
                    <>
                      <p className="font-medium">Spent {formatHoursFromMinutes(category.progressMinutes)}</p>
                      <p className="text-muted-foreground">This month {formatHoursFromMinutes(category.actualMinutes)}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">Actual {formatHoursFromMinutes(category.actualMinutes)}</p>
                      <p className="text-muted-foreground">Projected {formatHoursFromMinutes(category.projectedMinutes)}</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
