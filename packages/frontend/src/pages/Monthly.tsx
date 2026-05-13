import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MonthlyOverviewCard } from '@/components/MonthlyOverviewCard';
import { MonthlyGoalsCard } from '@/components/MonthlyGoalsCard';
import { MonthlyFocusCard } from '@/components/MonthlyFocusCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMonthlySummary } from '@/hooks/useMonthlySummary';
import { getCurrentMonthYear, shiftMonth } from '@/lib/monthly';
import { useState } from 'react';

export function Monthly() {
  const [monthYear, setMonthYear] = useState(() => getCurrentMonthYear());
  const { data: summary, isLoading } = useMonthlySummary(monthYear);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <Button variant="ghost" size="icon" onClick={() => setMonthYear((current) => shiftMonth(current, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <p className="font-semibold">{summary?.monthLabel ?? monthYear}</p>
            <p className="text-sm text-muted-foreground">
              {summary?.isCurrentMonth ? 'Current month' : `Viewing ${monthYear}`}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setMonthYear((current) => shiftMonth(current, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : summary ? (
        <>
          <MonthlyOverviewCard summary={summary} />
          <MonthlyFocusCard summary={summary} />
          <MonthlyGoalsCard summary={summary} />
        </>
      ) : (
        <div className="py-12 text-center text-muted-foreground">No monthly summary available.</div>
      )}
    </div>
  );
}
