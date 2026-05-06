import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
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

const COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8',
  '#82CA9D', '#FFC658', '#FF7C7C', '#8DD1E1', '#D084D0',
];

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

  // Calculate projected hours per category (from goals)
  const projectedData = useMemo(() => {
    const result = categories
      .map((cat) => {
        const goal = allGoals.find((g) => g.categoryId === cat.id)?.goal;
        const hours = goal ? goal.availableHours + goal.availableMinutes / 60 : 0;
        return {
          name: cat.name,
          value: Math.round(hours * 10) / 10,
          color: cat.color,
          categoryId: cat.id,
          bonus: cat.bonus,
        };
      })
      .filter((item) => item.value > 0);
    return result;
  }, [categories, allGoals]);

  // Calculate actual hours per category (from entries)
  const actualData = useMemo(() => {
    const hoursPerCategory = new Map<number, number>();

    for (const entry of monthEntries) {
      if (!entry.endTime) continue;
      const duration = new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime();
      const minutes = duration / 60000;
      hoursPerCategory.set(entry.categoryId, (hoursPerCategory.get(entry.categoryId) ?? 0) + minutes);
    }

    const result = categories
      .map((cat) => {
        const minutes = hoursPerCategory.get(cat.id) ?? 0;
        const hours = minutes / 60;
        return {
          name: cat.name,
          value: Math.round(hours * 10) / 10,
          color: cat.color,
          categoryId: cat.id,
          bonus: cat.bonus,
        };
      })
      .filter((item) => item.value > 0);

    return result;
  }, [categories, monthEntries]);

  // Calculate bonus vs non-bonus hours
  const bonusData = useMemo(() => {
    let bonusHours = 0;
    let nonBonusHours = 0;

    for (const item of actualData) {
      if (item.bonus) {
        bonusHours += item.value;
      } else {
        nonBonusHours += item.value;
      }
    }

    return [
      { name: 'Bonus-eligible', value: Math.round(bonusHours * 10) / 10 },
      { name: 'Non-bonus', value: Math.round(nonBonusHours * 10) / 10 },
    ];
  }, [actualData]);

  const totalProjected = projectedData.reduce((sum, item) => sum + item.value, 0);
  const totalActual = actualData.reduce((sum, item) => sum + item.value, 0);
  const totalBonus = bonusData.reduce((sum, item) => sum + item.value, 0);

  if (projectedData.length === 0 && actualData.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monthly Overview — {monthYear}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Pie Charts Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Projected Composition */}
          <div>
            <h3 className="text-sm font-medium mb-4 text-center">Projected Composition</h3>
            {projectedData.length > 0 ? (
              <div className="flex justify-center">
                <ResponsiveContainer width={250} height={200}>
                  <PieChart>
                    <Pie
                      data={projectedData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}h`}
                      outerRadius={60}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {projectedData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `${value}h`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center">No goals set</p>
            )}
            {totalProjected > 0 && (
              <p className="text-xs text-muted-foreground text-center mt-2">Total: {totalProjected}h</p>
            )}
          </div>

          {/* Actual Composition */}
          <div>
            <h3 className="text-sm font-medium mb-4 text-center">Actual Composition</h3>
            {actualData.length > 0 ? (
              <div className="flex justify-center">
                <ResponsiveContainer width={250} height={200}>
                  <PieChart>
                    <Pie
                      data={actualData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}h`}
                      outerRadius={60}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {actualData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `${value}h`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center">No hours logged</p>
            )}
            {totalActual > 0 && (
              <p className="text-xs text-muted-foreground text-center mt-2">Total: {totalActual}h</p>
            )}
          </div>
        </div>

        {/* Bonus vs Non-Bonus Bar */}
        {totalActual > 0 && (
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
