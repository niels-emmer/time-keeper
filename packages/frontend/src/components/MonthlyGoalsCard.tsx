import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatHoursFromMinutes, getMonthlyStatusMeta, getTargetCadenceLabel } from '@/lib/monthly';
import type { MonthlySummary } from '@time-keeper/shared';

export function MonthlyGoalsCard({ summary }: { summary: MonthlySummary }) {
  const goalRows = useMemo(
    () => summary.categories.filter((category) => category.goalMinutes > 0),
    [summary.categories]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Targets — {summary.monthLabel}</CardTitle>
      </CardHeader>
      <CardContent>
        {goalRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No categories with active targets for this month. Edit a category in Settings to add one.
          </p>
        ) : (
          <div className="space-y-3">
            {goalRows.map((category) => {
              const progressPercent = category.goalMinutes > 0
                ? Math.min((category.progressMinutes / category.goalMinutes) * 100, 100)
                : 0;
              const statusMeta = getMonthlyStatusMeta(category.status);
              const cadenceLabel = getTargetCadenceLabel(category.targetCadence);
              const balanceText = category.targetCadence === 'one_time'
                ? category.remainingMinutes < 0
                  ? `Overrun ${formatHoursFromMinutes(Math.abs(category.remainingMinutes))}`
                  : category.remainingMinutes === 0
                    ? 'Budget spent'
                    : `Remaining ${formatHoursFromMinutes(category.remainingMinutes)}`
                : category.remainingMinutes > 0
                  ? `Need ${formatHoursFromMinutes(category.requiredDailyMinutes)} / day`
                  : category.status === 'over-target'
                    ? `Over by ${formatHoursFromMinutes(Math.abs(category.remainingMinutes))}`
                    : 'Target reached';

              return (
                <div key={category.categoryId} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
                        <span className="text-sm font-medium">{category.name}</span>
                        {category.workdayCode && (
                          <span className="text-xs text-muted-foreground">{category.workdayCode}</span>
                        )}
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {cadenceLabel}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.className}`}>
                          {statusMeta.label}
                        </span>
                      </div>

                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-blue-500 transition-all"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>

                      <div className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                        <p>This month: {formatHoursFromMinutes(category.actualMinutes)}</p>
                        <p>Target: {formatHoursFromMinutes(category.goalMinutes)}</p>
                        <p>{balanceText}</p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      {category.targetCadence === 'one_time' ? (
                        <>
                          <p className="text-sm font-medium">Spent {formatHoursFromMinutes(category.progressMinutes)}</p>
                          <p className="text-xs text-muted-foreground">
                            This month {formatHoursFromMinutes(category.actualMinutes)}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium">{formatHoursFromMinutes(category.actualMinutes)}</p>
                          <p className="text-xs text-muted-foreground">Projected {formatHoursFromMinutes(category.projectedMinutes)}</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
