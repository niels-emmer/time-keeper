import { useState, useEffect } from 'react';
import { useSettings, useUpdateSettings } from '@/hooks/useSettings';

export function WeeklyGoalSetting() {
  const { data, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [value, setValue] = useState<number>(40);

  useEffect(() => {
    if (data !== undefined) setValue(data.weeklyGoalHours);
  }, [data]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const n = Math.max(0, Math.min(40, Number(e.target.value)));
    setValue(n);
  }

  function handleBlur() {
    if (data !== undefined && value !== data.weeklyGoalHours) {
      update.mutate(value);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Work week</h2>

      <div className="rounded-lg border bg-card px-4 py-3 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="font-medium">Weekly goal</span>
            <p className="text-muted-foreground text-xs mt-0.5">
              Used for progress display and end-of-day rounding cap (0–40 h)
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="number"
              min={0}
              max={40}
              step={1}
              value={isLoading ? '' : value}
              onChange={handleChange}
              onBlur={handleBlur}
              disabled={isLoading || update.isPending}
              className="w-16 rounded-md border bg-background px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <span className="text-muted-foreground">h</span>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={isLoading ? 40 : value}
          onChange={handleChange}
          onMouseUp={handleBlur}
          onTouchEnd={handleBlur}
          disabled={isLoading || update.isPending}
          className="w-full accent-primary disabled:opacity-50"
        />
      </div>
    </div>
  );
}
