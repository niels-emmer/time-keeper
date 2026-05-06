import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useCategories } from '@/hooks/useCategories';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { TimeEntry } from '@time-keeper/shared';

// Get current month in YYYY-MM format
function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// Get all time entries (by querying the week-start to month-end)
function getMonthStartDate(month: string): string {
  const [year, monthStr] = month.split('-');
  return `${year}-${monthStr}-01`;
}

export function MonthlyGoalsCard() {
  const { data: categories = [] } = useCategories();
  const monthYear = useMemo(() => getCurrentMonth(), []);
  const monthStart = useMemo(() => getMonthStartDate(monthYear), [monthYear]);

  const [editingGoal, setEditingGoal] = useState<{
    categoryId: number;
    categoryName: string;
    currentGoalHours: number;
    currentGoalMinutes: number;
  } | null>(null);

  const [editForm, setEditForm] = useState({ hours: 0, minutes: 0 });

  const qc = useQueryClient();
  const updateGoal = useMutation({
    mutationFn: ({ categoryId, hours, minutes }: { categoryId: number; hours: number; minutes: number }) =>
      api.monthlyGoals.set({ categoryId, monthYear, availableHours: hours, availableMinutes: minutes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['monthlyGoals', monthYear] });
      setEditingGoal(null);
    },
  });

  // Fetch entries for the current month (approx)
  // We'll make a rough estimate: fetch from month start to end
  const { data: monthEntries = [] } = useQuery({
    queryKey: ['monthEntries', monthYear],
    queryFn: async () => {
      // Fetch weekly summaries or use a different approach
      // For now, we'll calculate from categories' entries by fetching week-by-week
      // This is a simplification; ideally there'd be a dedicated month-by-date endpoint
      const entries: TimeEntry[] = [];
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const monthStart = new Date(Date.UTC(currentYear, currentMonth, 1));
      const monthEnd = new Date(Date.UTC(currentYear, currentMonth + 1, 0));

      // For simplicity, we'll fetch from the API — but this would benefit from a dedicated endpoint
      // For now, estimate from the weekly summary or return empty (user would see M-T-D as 0)
      return entries;
    },
  });

  // Calculate month-to-date minutes per category
  const mtdByCategory = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    const result = new Map<number, number>();

    for (const entry of monthEntries) {
      if (!entry.endTime) continue; // Skip running timers
      const entryDate = new Date(entry.startTime);
      if (
        entryDate.getUTCFullYear() === currentYear &&
        entryDate.getUTCMonth() === currentMonth &&
        entryDate.getUTCDate() <= currentDay
      ) {
        const duration = new Date(entry.endTime).getTime() - entryDate.getTime();
        const minutes = Math.floor(duration / 60000);
        result.set(entry.categoryId, (result.get(entry.categoryId) ?? 0) + minutes);
      }
    }

    return result;
  }, [monthEntries]);

  // Fetch monthly goals for each category
  const goalQueries = categories.map((cat) =>
    useQuery({
      queryKey: ['monthlyGoal', monthYear, cat.id],
      queryFn: () => api.monthlyGoals.get(cat.id, monthYear),
    })
  );

  const goalsByCategory = useMemo(() => {
    const result = new Map<number, { hours: number; minutes: number }>();
    for (let i = 0; i < categories.length; i++) {
      const goal = goalQueries[i].data?.goal;
      if (goal) {
        result.set(categories[i].id, { hours: goal.availableHours, minutes: goal.availableMinutes });
      }
    }
    return result;
  }, [categories, goalQueries]);

  const activeCategoriesWithGoals = categories.filter(
    (cat) => goalsByCategory.has(cat.id) || mtdByCategory.has(cat.id)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monthly Goals — {monthYear}</CardTitle>
      </CardHeader>
      <CardContent>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No categories yet. Create categories to set monthly goals.
          </p>
        ) : (
          <div className="space-y-3">
            {categories.map((cat) => {
              const mtdMinutes = mtdByCategory.get(cat.id) ?? 0;
              const mtdHours = mtdMinutes / 60;
              const goal = goalsByCategory.get(cat.id);
              const goalHours = goal?.hours ?? 0;
              const progressPercent = goalHours > 0 ? (mtdHours / goalHours) * 100 : 0;

              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    setEditingGoal({ categoryId: cat.id, categoryName: cat.name, currentGoalHours: goalHours, currentGoalMinutes: goal?.minutes ?? 0 });
                    setEditForm({ hours: goalHours, minutes: goal?.minutes ?? 0 });
                  }}
                  className="w-full text-left group"
                >
                  <div className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="font-medium text-sm">{cat.name}</span>
                      </div>
                      {goal && (
                        <div className="mt-2 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all"
                            style={{ width: `${Math.min(progressPercent, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>

                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium">
                        {mtdHours.toFixed(1)}h {goal && `/ ${goalHours}h`}
                      </p>
                      {goal && (
                        <p className="text-xs text-muted-foreground">
                          {progressPercent > 100
                            ? `+${(progressPercent - 100).toFixed(0)}%`
                            : `${progressPercent.toFixed(0)}%`}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Edit dialog */}
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
                onChange={(e) => setEditForm((f) => ({ ...f, hours: Number(e.target.value) }))}
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
                onChange={(e) => setEditForm((f) => ({ ...f, minutes: Number(e.target.value) }))}
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
