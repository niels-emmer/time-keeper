import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MonthlyOverviewCard } from '@/components/MonthlyOverviewCard';
import { MonthlyGoalsCard } from '@/components/MonthlyGoalsCard';
import { MonthlyFocusCard } from '@/components/MonthlyFocusCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { QueryState } from '@/components/QueryState';
import { useMonthlySummary } from '@/hooks/useMonthlySummary';
import { getCurrentMonthYear, shiftMonth } from '@/lib/monthly';
import { useState } from 'react';

export function Monthly() {
  const [monthYear, setMonthYear] = useState(() => getCurrentMonthYear());
  const { data: summary, isLoading, isError, error, refetch } = useMonthlySummary(monthYear);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonthYear((current) => shiftMonth(current, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <p className="font-semibold">{summary?.monthLabel ?? monthYear}</p>
            <p className="text-sm text-muted-foreground">
              {summary?.isCurrentMonth ? 'Current month' : `Viewing ${monthYear}`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonthYear((current) => shiftMonth(current, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <QueryState isLoading loadingLabel="Loading monthly summary…" />
      ) : isError ? (
        <QueryState
          isError
          error={error}
          errorTitle="Could not load this month"
          onRetry={() => refetch()}
        />
      ) : summary ? (
        <>
          <MonthlyOverviewCard summary={summary} />
          <MonthlyFocusCard summary={summary} />
          <MonthlyGoalsCard summary={summary} />
        </>
      ) : (
        <QueryState
          isEmpty
          emptyTitle="No monthly summary available"
          emptyDescription="Pick another month or log some time first."
        />
      )}
    </div>
  );
}
