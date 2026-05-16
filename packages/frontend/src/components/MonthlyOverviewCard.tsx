import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatHoursFromMinutes } from '@/lib/monthly';
import type { MonthlySummary } from '@time-keeper/shared';

export function MonthlyOverviewCard({ summary }: { summary: MonthlySummary }) {
  const comparisonData = useMemo(
    () => summary.categories
      .filter((category) => category.goalMinutes > 0 || category.actualMinutes > 0)
      .map((category) => ({
        name: category.workdayCode || category.name,
        projected: Number((category.goalMinutes / 60).toFixed(1)),
        actual: Number((category.actualMinutes / 60).toFixed(1)),
      })),
    [summary]
  );

  const maxValue = useMemo(() => {
    if (comparisonData.length === 0) return 0;
    const max = Math.max(...comparisonData.map((item) => Math.max(item.projected, item.actual)));
    return Math.ceil(max * 1.2);
  }, [comparisonData]);

  const billableData = [
    { name: 'billable', value: Number((summary.billableMinutes / 60).toFixed(1)) },
    { name: 'non billable', value: Number((summary.nonBillableMinutes / 60).toFixed(1)) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monthly Overview — {summary.monthLabel}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tracked so far</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatHoursFromMinutes(summary.totalActualMinutes)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Goal total {formatHoursFromMinutes(summary.totalGoalMinutes)}
            </p>
          </div>
          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Month progress</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{summary.daysElapsed}/{summary.daysInMonth}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.remainingDays} day{summary.remainingDays === 1 ? '' : 's'} remaining
            </p>
          </div>
          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Billable split</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatHoursFromMinutes(summary.billableMinutes)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Non-billable {formatHoursFromMinutes(summary.nonBillableMinutes)}
            </p>
          </div>
        </div>

        {comparisonData.length > 0 && (
          <div>
            <h3 className="mb-4 text-sm font-medium">Projected vs Actual Hours by Category</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={comparisonData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis domain={[0, maxValue]} />
                <Tooltip formatter={(value) => `${value}h`} />
                <Legend />
                <Bar dataKey="projected" fill="#8884d8" name="Goal" radius={[8, 8, 0, 0]} />
                <Bar dataKey="actual" fill="#00C49F" name="Actual" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {(summary.billableMinutes > 0 || summary.nonBillableMinutes > 0) && (
          <div>
            <h3 className="mb-4 text-sm font-medium">Hours by Type</h3>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={billableData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value) => `${value}h`} />
                <Bar dataKey="value" fill="#8884d8" radius={[8, 8, 0, 0]}>
                  {billableData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.name === 'billable' ? '#00C49F' : '#FFBB28'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
