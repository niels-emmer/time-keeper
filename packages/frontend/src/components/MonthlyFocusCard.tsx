import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatHoursFromMinutes, getFocusCategories, getMonthlyStatusMeta } from '@/lib/monthly';
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
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.className}`}>
                      {statusMeta.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {category.status === 'behind' && (
                      <>Behind pace. Need {formatHoursFromMinutes(category.requiredDailyMinutes)} per remaining day to hit the target.</>
                    )}
                    {category.status === 'over-target' && (
                      <>Already above target by {formatHoursFromMinutes(category.actualMinutes - category.goalMinutes)}.</>
                    )}
                    {category.status === 'no-goal' && (
                      <>Tracked {formatHoursFromMinutes(category.actualMinutes)} without a monthly goal. Consider setting one.</>
                    )}
                    {category.status === 'on-pace' && (
                      <>On pace with {formatHoursFromMinutes(category.remainingMinutes)} remaining.</>
                    )}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium">Actual {formatHoursFromMinutes(category.actualMinutes)}</p>
                  <p className="text-muted-foreground">Projected {formatHoursFromMinutes(category.projectedMinutes)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
