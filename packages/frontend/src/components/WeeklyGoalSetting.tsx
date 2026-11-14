import { useState, useEffect } from 'react';
import { useSettings, useUpdateSettings } from '@/hooks/useSettings';
import { QueryState } from '@/components/QueryState';

function getTimeZoneOptions(current: string): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const supported = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : [];
  const base =
    supported.length > 0
      ? supported
      : ['UTC', 'Europe/Amsterdam', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];
  return base.includes(current) ? base : [current, ...base];
}

export function WeeklyGoalSetting() {
  const { data, isLoading, isError, error, refetch } = useSettings();
  const update = useUpdateSettings();
  const [value, setValue] = useState<number>(40);
  const [increment, setIncrement] = useState<30 | 60>(60);
  const [timeZone, setTimeZone] = useState<string>('UTC');

  useEffect(() => {
    if (data !== undefined) {
      setValue(data.weeklyGoalHours);
      setIncrement(data.roundingIncrementMinutes);
      setTimeZone(data.timezone);
    }
  }, [data]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const n = Math.max(0, Math.min(40, Number(e.target.value)));
    setValue(n);
  }

  function handleBlur() {
    if (data !== undefined && value !== data.weeklyGoalHours) {
      update.mutate({ weeklyGoalHours: value, roundingIncrementMinutes: increment, timezone: timeZone });
    }
  }

  function handleIncrementChange(next: 30 | 60) {
    setIncrement(next);
    update.mutate({
      weeklyGoalHours: value,
      roundingIncrementMinutes: next,
      timezone: timeZone,
    });
  }

  function handleTimeZoneChange(next: string) {
    setTimeZone(next);
    update.mutate({
      weeklyGoalHours: value,
      roundingIncrementMinutes: increment,
      timezone: next,
    });
  }

  const timeZoneOptions = getTimeZoneOptions(timeZone);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Work week</h2>
        <QueryState isLoading loadingLabel="Loading work-week settings…" className="py-8" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Work week</h2>
        <QueryState
          isError
          error={error}
          errorTitle="Could not load work-week settings"
          onRetry={() => refetch()}
          className="py-8"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Work week</h2>

      <div className="rounded-lg border bg-card px-4 py-3 space-y-3 text-sm">
        {/* ── Weekly goal ─────────────────────────────────────── */}
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

        {/* ── Divider ─────────────────────────────────────────── */}
        <div className="border-t" />

        {/* ── Rounding increment ──────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="font-medium">Rounding increment</span>
            <p className="text-muted-foreground text-xs mt-0.5">
              Round each category up to the nearest interval
            </p>
          </div>
          <div
            className="flex rounded-md border overflow-hidden shrink-0 disabled:opacity-50"
            role="group"
            aria-label="Rounding increment"
          >
            {([30, 60] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => handleIncrementChange(opt)}
                disabled={isLoading || update.isPending}
                className={[
                  'px-3 py-1 text-sm font-medium transition-colors',
                  increment === opt
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted',
                  opt === 30 ? 'border-r' : '',
                ].join(' ')}
              >
                {opt} min
              </button>
            ))}
          </div>
        </div>
        {/* ── Divider ─────────────────────────────────────────── */}
        <div className="border-t" />

        {/* ── Time zone ───────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="font-medium">Time zone</span>
            <p className="text-muted-foreground text-xs mt-0.5">
              Groups entries into local days. Defaults to UTC
            </p>
          </div>
          <select
            aria-label="Time zone"
            value={isLoading ? 'UTC' : timeZone}
            onChange={(event) => handleTimeZoneChange(event.target.value)}
            disabled={isLoading || update.isPending}
            className="max-w-[16rem] rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            {timeZoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
