import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { useCategories } from '@/hooks/useCategories';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toISOWeek } from '@time-keeper/shared';
import type { TimeEntry } from '@time-keeper/shared';

// Get current month in YYYY-MM format
function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function MonthlyOverviewCard() {
  const { data: categories = [] } = useCategories();
  const monthYear = useMemo(() => getCurrentMonth(), []);

  // Fetch all goals for the month
  const { data: allGoals = [] } = useQuery({
    queryKey: ['monthlyGoals', monthYear],
    queryFn: async () => {
      const goals = await Promise.all(
        categories.map((cat) =>
          api.monthlyGoals.get(cat.id, monthYear).then((res) => ({
            categoryId: cat.id,
            goal: res.goal,
          }))
        )
      );
      return goals;
    },
    enabled: categories.length > 0,
  });

  // Fetch entries for the current month
  const { data: monthEntries = [] } = useQuery({
    queryKey: ['monthEntries', monthYear],
    queryFn: async () => {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const monthStart = new Date(Date.UTC(currentYear, currentMonth, 1));
      const monthEnd = new Date(Date.UTC(currentYear, currentMonth + 1, 0));

      const allEntries: TimeEntry[] = [];
      const currentDate = new Date(monthStart);
      const fetchedWeeks = new Set<string>();

      while (currentDate <= monthEnd) {
        const weekStr = toISOWeek(currentDate);

        if (!fetchedWeeks.has(weekStr)) {
          fetchedWeeks.add(weekStr);
          try {
            const weekEntries = await api.entries.listByWeek(weekStr);
            const monthEntries = weekEntries.filter((entry) => {
              const entryDate = new Date(entry.startTime);
              return (
                entryDate.getUTCFullYear() === currentYear &&
                entryDate.getUTCMonth() === currentMonth
              );
            });
            allEntries.push(...monthEntries);
          } catch (err) {
            console.warn(`Failed to fetch week ${weekStr}:`, err);
          }
        }

        currentDate.setUTCDate(currentDate.getUTCDate() + 7);
      }

      return allEntries;
    },
  });

  // Calculate comparison data: projected vs actual for categories with goals or hours
  const comparisonData = useMemo(() => {
    const hoursPerCategory = new Map<number, number>();

    // Calculate actual hours per category
    for (const entry of monthEntries) {
      if (!entry.endTime) continue;
      const duration = new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime();
      const minutes = duration / 60000;
      hoursPerCategory.set(entry.categoryId, (hoursPerCategory.get(entry.categoryId) ?? 0) + minutes);
    }

    // Build chart data for categories with goals or actual hours
    const data = categories
      .map((cat) => {
        const goal = allGoals.find((g) => g.categoryId === cat.id)?.goal;
        const projectedHours = goal ? goal.availableHours + goal.availableMinutes / 60 : 0;
        const actualMinutes = hoursPerCategory.get(cat.id) ?? 0;
        const actualHours = actualMinutes / 60;

        // Only include if there's a goal or actual hours
        if (projectedHours === 0 && actualHours === 0) {
          return null;
        }

        return {
          name: cat.workdayCode || cat.name, // Use workday code or fallback to name
          projected: Math.round(projectedHours * 10) / 10,
          actual: Math.round(actualHours * 10) / 10,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return data;
  }, [categories, allGoals, monthEntries]);

  const maxValue = useMemo(() => {
    if (comparisonData.length === 0) return 0;
    const max = Math.max(
      ...comparisonData.map((item) => Math.max(item.projected, item.actual))
    );
    return Math.ceil(max * 1.2); // Add 20% padding for readability
  }, [comparisonData]);

  const bonusData = useMemo(() => {
    const hoursPerCategory = new Map<number, number>();

    for (const entry of monthEntries) {
      if (!entry.endTime) continue;
      const duration = new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime();
      const minutes = duration / 60000;
      hoursPerCategory.set(entry.categoryId, (hoursPerCategory.get(entry.categoryId) ?? 0) + minutes);
    }

    let bonusHours = 0;
    let nonBonusHours = 0;

    for (const cat of categories) {
      const minutes = hoursPerCategory.get(cat.id) ?? 0;
      const hours = minutes / 60;
      if (cat.bonus) {
        bonusHours += hours;
      } else {
        nonBonusHours += hours;
      }
    }

    return [
      { name: 'Bonus-eligible', value: Math.round(bonusHours * 10) / 10 },
      { name: 'Non-bonus', value: Math.round(nonBonusHours * 10) / 10 },
    ];
  }, [categories, monthEntries]);

  if (comparisonData.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monthly Overview — {monthYear}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Projected vs Actual Comparison Bar Chart */}
        <div>
          <h3 className="text-sm font-medium mb-4">Projected vs Actual Hours by Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={comparisonData}
              margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis domain={[0, maxValue]} />
              <Tooltip formatter={(value) => `${value}h`} />
              <Legend />
              <Bar dataKey="projected" fill="#8884d8" name="Projected" radius={[8, 8, 0, 0]} />
              <Bar dataKey="actual" fill="#00C49F" name="Actual" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Bonus vs Non-Bonus Bar */}
        {bonusData.some((item) => item.value > 0) && (
          <div>
            <h3 className="text-sm font-medium mb-4">Hours by Type</h3>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart
                data={bonusData}
                margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value) => `${value}h`} />
                <Bar dataKey="value" fill="#8884d8" radius={[8, 8, 0, 0]}>
                  {bonusData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.name === 'Bonus-eligible' ? '#00C49F' : '#FFBB28'}
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
