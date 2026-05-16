import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DailyLogDialog } from '@/components/DailyLogDialog';
import { useWeeklySummary, useRoundWeek, useAdjustCell } from '@/hooks/useSummary';
import {
  buildWeeklyExport,
  getStoredWeeklyExportFormat,
  getWeeklyExportFormats,
  setStoredWeeklyExportFormat,
  type WeeklyExportFormat,
} from '@/lib/weeklyExport';
import { toISOWeek } from '@time-keeper/shared';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekOffset(baseWeek: string, offset: number): string {
  const [yearStr, weekStr] = baseWeek.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const date = new Date(Date.UTC(year, 0, 4));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() || 7) + 1 + (week - 1) * 7 + offset * 7);
  return toISOWeek(date);
}

function downloadExport(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function WeeklySummary() {
  const [week, setWeek] = useState(() => toISOWeek(new Date()));
  const [exportFormat, setExportFormat] = useState<WeeklyExportFormat>(() => getStoredWeeklyExportFormat());
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const { data: summary, isLoading } = useWeeklySummary(week);
  const roundWeek = useRoundWeek();
  const adjustCell = useAdjustCell();

  const [localOverrides, setLocalOverrides] = useState<Map<string, number>>(new Map());
  const [editingCell, setEditingCell] = useState<{ categoryId: number; date: string; value: string } | null>(null);
  const [dayLogDate, setDayLogDate] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStoredWeeklyExportFormat(exportFormat);
  }, [exportFormat]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  useEffect(() => {
    setLocalOverrides(new Map());
    setEditingCell(null);
  }, [week]);

  useEffect(() => {
    if (editingCell) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingCell]);

  const exportArtifact = useMemo(
    () => summary ? buildWeeklyExport(summary, exportFormat) : null,
    [summary, exportFormat]
  );

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  }

  if (!summary || !exportArtifact) return null;

  const allCategories = new Map<number, { name: string; color: string; workdayCode: string | null }>();
  for (const day of summary.days) {
    for (const category of day.categories) {
      allCategories.set(category.categoryId, {
        name: category.name,
        color: category.color,
        workdayCode: category.workdayCode,
      });
    }
  }
  const categoryList = Array.from(allCategories.entries());

  const getDisplayMinutes = (categoryId: number, date: string): number => {
    const key = `${categoryId}-${date}`;
    if (localOverrides.has(key)) return localOverrides.get(key)!;
    const day = summary.days.find((item) => item.date === date);
    return day?.categories.find((item) => item.categoryId === categoryId)?.minutes ?? 0;
  };

  const computedDayMinutes = summary.days.map((day) =>
    categoryList.reduce((sum, [categoryId]) => sum + getDisplayMinutes(categoryId, day.date), 0)
  );
  const computedWeekMinutes = computedDayMinutes.reduce((sum, value) => sum + value, 0);
  const goalHours = summary.goalMinutes / 60;
  const totalHours = computedWeekMinutes / 60;
  const remainingHours = Math.max(goalHours - totalHours, 0);
  const exceededHours = Math.max(totalHours - goalHours, 0);
  const activeCategoryCount = categoryList.filter(([categoryId]) =>
    summary.days.some((day) => getDisplayMinutes(categoryId, day.date) > 0)
  ).length;
  const busiestDayIndex = computedDayMinutes.reduce(
    (bestIndex, currentMinutes, index, all) => currentMinutes > all[bestIndex] ? index : bestIndex,
    0
  );

  const barSegments = categoryList
    .map(([categoryId, category]) => {
      const minutes = summary.days.reduce(
        (sum, day) => sum + (day.categories.find((item) => item.categoryId === categoryId)?.minutes ?? 0),
        0
      );
      return { categoryId, name: category.name, color: category.color, minutes };
    })
    .filter((segment) => segment.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes);

  async function handleCopy() {
    if (!exportArtifact) return;

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(exportArtifact.content);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  function handleCellClick(categoryId: number, date: string) {
    const minutes = getDisplayMinutes(categoryId, date);
    setEditingCell({ categoryId, date, value: minutes === 0 ? '' : String(minutes / 60) });
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!editingCell) return;
    const raw = event.target.value;
    setEditingCell({ ...editingCell, value: raw });
    const hours = parseFloat(raw);
    if (!Number.isNaN(hours) && hours >= 0) {
      setLocalOverrides((previous) => new Map(previous).set(
        `${editingCell.categoryId}-${editingCell.date}`,
        Math.round(hours * 60)
      ));
    }
  }

  async function handleSave() {
    if (!editingCell) return;
    const hours = editingCell.value.trim() === '' ? 0 : parseFloat(editingCell.value);
    if (Number.isNaN(hours) || hours < 0) {
      handleCancel();
      return;
    }

    const minutes = Math.round(hours * 60);
    const { categoryId, date } = editingCell;
    const key = `${categoryId}-${date}`;
    setLocalOverrides((previous) => new Map(previous).set(key, minutes));
    setEditingCell(null);

    try {
      await adjustCell.mutateAsync({ date, categoryId, minutes });
      setLocalOverrides((previous) => {
        const next = new Map(previous);
        next.delete(key);
        return next;
      });
    } catch {
      setLocalOverrides((previous) => {
        const next = new Map(previous);
        next.delete(key);
        return next;
      });
    }
  }

  function handleCancel() {
    if (!editingCell) return;
    setLocalOverrides((previous) => {
      const next = new Map(previous);
      next.delete(`${editingCell.categoryId}-${editingCell.date}`);
      return next;
    });
    setEditingCell(null);
  }

  return (
    <div className="space-y-4">
      {/* Navigation and week summary */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => setWeek(getWeekOffset(week, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="font-semibold">{week}</p>
          <p className="text-sm text-muted-foreground">
            {totalHours.toFixed(1)}h / {goalHours}h
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setWeek(getWeekOffset(week, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Weekly totals and day logs card moved to top */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Weekly totals and day logs</CardTitle>
          <p className="text-sm text-muted-foreground">
            Click a total cell to adjust that day/category total directly. Click a day header to inspect, edit, or backfill the actual entries for that day.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-left font-medium text-muted-foreground">Category</th>
                {summary.days.map((day, index) => (
                  <th key={day.date} className="w-20 p-3 text-center font-medium text-muted-foreground">
                    <button
                      type="button"
                      className="mx-auto flex flex-col items-center rounded-md px-1 py-1 transition-colors hover:bg-muted"
                      onClick={() => setDayLogDate(day.date)}
                    >
                      <span>{DAYS[index]}</span>
                      <span className="text-[11px] text-muted-foreground">{day.date.slice(5)}</span>
                      <span className="text-[11px] text-primary">Log</span>
                    </button>
                  </th>
                ))}
                <th className="p-3 text-right font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {categoryList.map(([categoryId, category]) => {
                const rowDisplayMinutes = summary.days.map((day) => getDisplayMinutes(categoryId, day.date));
                const rowTotal = rowDisplayMinutes.reduce((sum, value) => sum + value, 0);
                if (rowTotal === 0) return null;

                return (
                  <tr key={categoryId} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: category.color }}
                        />
                        <span className="font-medium">{category.name}</span>
                        {category.workdayCode && (
                          <span className="text-xs text-muted-foreground">{category.workdayCode}</span>
                        )}
                      </div>
                    </td>
                    {summary.days.map((day, index) => {
                      const isEditing = editingCell?.categoryId === categoryId && editingCell?.date === day.date;
                      const displayMinutes = rowDisplayMinutes[index];

                      return (
                        <td
                          key={day.date}
                          className="p-0 text-center tabular-nums"
                          onClick={() => !isEditing && handleCellClick(categoryId, day.date)}
                        >
                          {isEditing ? (
                            <input
                              ref={inputRef}
                              type="number"
                              min="0"
                              step="0.5"
                              value={editingCell!.value}
                              onChange={handleInputChange}
                              onBlur={handleSave}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  handleSave();
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  handleCancel();
                                }
                              }}
                              className="w-16 rounded border border-ring bg-transparent px-1 py-2 text-center text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          ) : (
                            <span className="block cursor-pointer rounded p-3 transition-colors hover:bg-muted/50">
                              {displayMinutes > 0 ? `${(displayMinutes / 60).toFixed(1)}h` : '–'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-3 text-right font-semibold tabular-nums">{(rowTotal / 60).toFixed(1)}h</td>
                  </tr>
                );
              })}
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="p-3">Total</td>
                {summary.days.map((day, index) => (
                  <td
                    key={day.date}
                    className={`p-3 text-center tabular-nums ${computedDayMinutes[index] >= day.goalMinutes ? 'text-green-400' : ''}`}
                  >
                    {computedDayMinutes[index] > 0 ? `${(computedDayMinutes[index] / 60).toFixed(1)}h` : '–'}
                  </td>
                ))}
                <td
                  className={`p-3 text-right tabular-nums ${computedWeekMinutes >= summary.goalMinutes ? 'text-green-400' : ''}`}
                >
                  {(computedWeekMinutes / 60).toFixed(1)}h
                </td>
              </tr>
            </tbody>
          </table>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => roundWeek.mutate(week)}
              disabled={roundWeek.isPending}
            >
              {roundWeek.isPending ? 'Rounding…' : 'Round week'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Review this week card - reordered with Submit flow first, graph at bottom full-width */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Review this week before you submit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Submit flow box first */}
          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Submit flow</p>
            <p className="mt-1 text-base font-semibold">Review → choose format → copy/export</p>
            <p className="mt-1 text-sm text-muted-foreground">Use the preview below to confirm what you will paste.</p>
          </div>

          {/* Summary stats grid */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total tracked</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{totalHours.toFixed(1)}h</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {totalHours >= goalHours
                  ? `Goal met${exceededHours > 0 ? ` (+${exceededHours.toFixed(1)}h)` : ''}`
                  : `${remainingHours.toFixed(1)}h remaining to hit goal`}
              </p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Categories used</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{activeCategoryCount}</p>
              <p className="mt-1 text-sm text-muted-foreground">Distinct categories with hours this week.</p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Busiest day</p>
              <p className="mt-1 text-2xl font-semibold">{DAYS[busiestDayIndex]}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {computedDayMinutes[busiestDayIndex] > 0
                  ? `${(computedDayMinutes[busiestDayIndex] / 60).toFixed(1)}h logged`
                  : 'No time logged yet'}
              </p>
            </div>
          </div>

          {/* Bar chart at bottom, full width */}
          <div className="flex flex-col gap-2">
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
              {summary.totalMinutes === 0 ? null : barSegments.map((segment, index) => (
                <div
                  key={segment.categoryId}
                  title={`${segment.name}: ${(segment.minutes / 60).toFixed(1)}h`}
                  style={{
                    width: `${(segment.minutes / summary.totalMinutes) * 100}%`,
                    backgroundColor: segment.color,
                    borderRadius:
                      index === 0 && index === barSegments.length - 1
                        ? '9999px'
                        : index === 0
                        ? '9999px 0 0 9999px'
                        : index === barSegments.length - 1
                        ? '0 9999px 9999px 0'
                        : '0',
                  }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {barSegments.map((segment) => (
                <div key={segment.categoryId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: segment.color }}
                  />
                  <span>{segment.name}</span>
                  <span className="tabular-nums">{(segment.minutes / 60).toFixed(1)}h</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Handoff format and preview card remains below */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Choose your handoff format</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {getWeeklyExportFormats().map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={exportFormat === option.value ? 'default' : 'outline'}
                onClick={() => setExportFormat(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-sm font-medium">{exportArtifact.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{exportArtifact.description}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Preview</h3>
              <span className="text-xs text-muted-foreground">{exportArtifact.filename}</span>
            </div>
            <textarea
              readOnly
              value={exportArtifact.content}
              className="min-h-[220px] w-full rounded-xl border bg-background p-3 font-mono text-xs leading-5 text-foreground"
              aria-label="Weekly export preview"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleCopy} className="min-w-[10rem]">
              {copyState === 'copied' ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy {getWeeklyExportFormats().find((option) => option.value === exportFormat)?.label}
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadExport(exportArtifact.content, exportArtifact.filename, exportArtifact.mimeType)}
            >
              <Download className="mr-2 h-4 w-4" />
              Download {exportFormat === 'csv' ? 'CSV' : 'text'}
            </Button>
            {copyState === 'error' && (
              <p className="self-center text-sm text-destructive">
                Copy failed. You can still download the preview text.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <DailyLogDialog
        open={dayLogDate !== null}
        date={dayLogDate ?? summary.days[0]?.date ?? new Date().toISOString().slice(0, 10)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDayLogDate(null);
        }}
        onDateChange={setDayLogDate}
      />
    </div>
  );
}
