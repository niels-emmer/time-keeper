import { useState } from 'react';
import { Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useWeeklySummary, useRoundWeek } from '@/hooks/useSummary';
import { toISOWeek } from '@time-keeper/shared';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekOffset(baseWeek: string, offset: number): string {
  // Parse the week, move by offset weeks
  const [yearStr, weekStr] = baseWeek.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const d = new Date(Date.UTC(year, 0, 4));
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() || 7) + 1 + (week - 1) * 7 + offset * 7);
  return toISOWeek(d);
}

export function WeeklySummary() {
  const [week, setWeek] = useState(() => toISOWeek(new Date()));
  const { data: summary, isLoading } = useWeeklySummary(week);
  const roundWeek = useRoundWeek();

  function exportCsv() {
    if (!summary) return;

    // Collect all categories that appear this week (preserving order)
    const allCats = new Map<number, { name: string; workdayCode: string | null }>();
    for (const day of summary.days) {
      for (const cat of day.categories) {
        if (!allCats.has(cat.categoryId)) {
          allCats.set(cat.categoryId, { name: cat.name, workdayCode: cat.workdayCode });
        }
      }
    }

    const dayLabels = summary.days.map((d) => d.date);

    // Header row
    const rows: string[][] = [
      ['Category', 'Workday Code', ...dayLabels, 'Total'],
    ];

    // One row per category
    for (const [catId, cat] of allCats.entries()) {
      const dayHours = summary.days.map((d) => {
        const c = d.categories.find((c) => c.categoryId === catId);
        return c && c.minutes > 0 ? (c.minutes / 60).toFixed(2) : '0.00';
      });
      const totalHours = summary.days.reduce((sum, d) => {
        const c = d.categories.find((c) => c.categoryId === catId);
        return sum + (c?.minutes ?? 0);
      }, 0);
      rows.push([cat.name, cat.workdayCode ?? '', ...dayHours, (totalHours / 60).toFixed(2)]);
    }

    // Totals row
    const dayTotals = summary.days.map((d) => (d.totalMinutes / 60).toFixed(2));
    const weekTotal = (summary.totalMinutes / 60).toFixed(2);
    rows.push(['Total', '', ...dayTotals, weekTotal]);

    // Serialize to CSV
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `time-keeper-${summary.week}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  }

  if (!summary) return null;

  // Collect all category names that appear this week
  const allCats = new Map<number, { name: string; color: string; workdayCode: string | null }>();
  for (const day of summary.days) {
    for (const cat of day.categories) {
      allCats.set(cat.categoryId, {
        name: cat.name,
        color: cat.color,
        workdayCode: cat.workdayCode,
      });
    }
  }
  const catList = Array.from(allCats.entries());

  const totalHours = (summary.totalMinutes / 60).toFixed(1);
  const goalHours = summary.goalMinutes / 60;

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => setWeek(getWeekOffset(week, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="font-semibold">{week}</p>
          <p className="text-sm text-muted-foreground">
            {totalHours}h / {goalHours}h
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setWeek(getWeekOffset(week, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Summary table */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-left font-medium text-muted-foreground">Category</th>
                {DAYS.map((d) => (
                  <th key={d} className="p-3 text-center font-medium text-muted-foreground w-12">
                    {d}
                  </th>
                ))}
                <th className="p-3 text-right font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {catList.map(([catId, cat]) => {
                const rowMinutes = summary.days.map(
                  (d) => d.categories.find((c) => c.categoryId === catId)?.minutes ?? 0
                );
                const rowTotal = rowMinutes.reduce((a, b) => a + b, 0);
                if (rowTotal === 0) return null;
                return (
                  <tr key={catId} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="font-medium">{cat.name}</span>
                        {cat.workdayCode && (
                          <span className="text-xs text-muted-foreground">{cat.workdayCode}</span>
                        )}
                      </div>
                    </td>
                    {rowMinutes.map((m, i) => (
                      <td key={i} className="p-3 text-center tabular-nums">
                        {m > 0 ? `${(m / 60).toFixed(1)}h` : '–'}
                      </td>
                    ))}
                    <td className="p-3 text-right font-semibold tabular-nums">
                      {(rowTotal / 60).toFixed(1)}h
                    </td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="p-3">Total</td>
                {summary.days.map((d, i) => (
                  <td
                    key={i}
                    className={`p-3 text-center tabular-nums ${
                      d.totalMinutes >= d.goalMinutes ? 'text-green-400' : ''
                    }`}
                  >
                    {d.totalMinutes > 0 ? `${(d.totalMinutes / 60).toFixed(1)}h` : '–'}
                  </td>
                ))}
                <td
                  className={`p-3 text-right tabular-nums ${
                    summary.totalMinutes >= summary.goalMinutes ? 'text-green-400' : ''
                  }`}
                >
                  {totalHours}h
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={exportCsv} variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Export this week
        </Button>
        <Button
          variant="secondary"
          onClick={() => roundWeek.mutate(week)}
          disabled={roundWeek.isPending}
        >
          {roundWeek.isPending ? 'Rounding…' : 'Round week'}
        </Button>
      </div>
    </div>
  );
}
