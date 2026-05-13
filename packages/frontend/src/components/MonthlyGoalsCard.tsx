import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatHoursFromMinutes, getMonthlyStatusMeta } from '@/lib/monthly';
import type { MonthlySummary } from '@time-keeper/shared';

export function MonthlyGoalsCard({ summary }: { summary: MonthlySummary }) {
  const [editingGoal, setEditingGoal] = useState<{
    categoryId: number;
    categoryName: string;
    currentGoalMinutes: number;
  } | null>(null);
  const [editForm, setEditForm] = useState({ hours: 0, minutes: 0 });

  const qc = useQueryClient();
  const updateGoal = useMutation({
    mutationFn: ({ categoryId, hours, minutes }: { categoryId: number; hours: number; minutes: number }) =>
      api.monthlyGoals.set({
        categoryId,
        monthYear: summary.monthYear,
        availableHours: hours,
        availableMinutes: minutes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['summary', 'monthly', summary.monthYear] });
      setEditingGoal(null);
    },
  });

  const goalRows = useMemo(
    () => summary.categories.filter((category) => category.goalMinutes > 0 || category.actualMinutes > 0),
    [summary.categories]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monthly Goals — {summary.monthLabel}</CardTitle>
      </CardHeader>
      <CardContent>
        {goalRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No categories with goals or hours yet. Create categories or track time to start planning this month.
          </p>
        ) : (
          <div className="space-y-3">
            {goalRows.map((category) => {
              const progressPercent = category.goalMinutes > 0
                ? Math.min((category.actualMinutes / category.goalMinutes) * 100, 100)
                : 0;
              const statusMeta = getMonthlyStatusMeta(category.status);

              return (
                <button
                  key={category.categoryId}
                  onClick={() => {
                    setEditingGoal({
                      categoryId: category.categoryId,
                      categoryName: category.name,
                      currentGoalMinutes: category.goalMinutes,
                    });
                    setEditForm({
                      hours: Math.floor(category.goalMinutes / 60),
                      minutes: category.goalMinutes % 60,
                    });
                  }}
                  className="group w-full text-left"
                >
                  <div className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
                          <span className="text-sm font-medium">{category.name}</span>
                          {category.workdayCode && (
                            <span className="text-xs text-muted-foreground">{category.workdayCode}</span>
                          )}
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
                          <p>Actual: {formatHoursFromMinutes(category.actualMinutes)}</p>
                          <p>Goal: {formatHoursFromMinutes(category.goalMinutes)}</p>
                          <p>
                            {category.remainingMinutes > 0
                              ? `Need ${formatHoursFromMinutes(category.requiredDailyMinutes)} / day`
                              : 'Goal reached'}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium">{formatHoursFromMinutes(category.actualMinutes)}</p>
                        <p className="text-xs text-muted-foreground">
                          {category.goalMinutes > 0
                            ? `Projected ${formatHoursFromMinutes(category.projectedMinutes)}`
                            : 'No target set'}
                        </p>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={editingGoal !== null} onOpenChange={(open) => !open && setEditingGoal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Monthly Goal — {editingGoal?.categoryName}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Hours</label>
              <Input
                type="number"
                min="0"
                max="744"
                value={editForm.hours}
                onChange={(event) => setEditForm((current) => ({ ...current, hours: Number(event.target.value) }))}
                placeholder="e.g. 160"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Minutes</label>
              <Input
                type="number"
                min="0"
                max="59"
                value={editForm.minutes}
                onChange={(event) => setEditForm((current) => ({ ...current, minutes: Number(event.target.value) }))}
                placeholder="0–59"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Total: {editForm.hours}h {editForm.minutes}m
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingGoal(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingGoal) {
                  updateGoal.mutate({
                    categoryId: editingGoal.categoryId,
                    hours: editForm.hours,
                    minutes: editForm.minutes,
                  });
                }
              }}
              disabled={updateGoal.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
