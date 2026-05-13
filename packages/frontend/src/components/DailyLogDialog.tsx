import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatDuration, elapsedMinutes, toDateString } from '@time-keeper/shared';
import { useCategories } from '@/hooks/useCategories';
import { useCreateEntry, useDeleteEntry, useEntries, useUpdateEntry } from '@/hooks/useEntries';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { TimeEntry } from '@time-keeper/shared';

interface Props {
  open: boolean;
  date: string;
  onOpenChange: (open: boolean) => void;
  onDateChange: (date: string) => void;
}

interface EntryFormState {
  categoryId: string;
  startLocal: string;
  endLocal: string;
  notes: string;
}

function shiftDate(date: string, offsetDays: number) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + offsetDays);
  return toDateString(next);
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toLocalDateTimeInputValue(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoFromLocalDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date/time');
  }
  return date.toISOString();
}

function buildDefaultForm(date: string): EntryFormState {
  return {
    categoryId: '',
    startLocal: `${date}T09:00`,
    endLocal: `${date}T10:00`,
    notes: '',
  };
}

function buildEditForm(entry: TimeEntry): EntryFormState {
  return {
    categoryId: String(entry.categoryId),
    startLocal: toLocalDateTimeInputValue(entry.startTime),
    endLocal: entry.endTime ? toLocalDateTimeInputValue(entry.endTime) : '',
    notes: entry.notes ?? '',
  };
}

function formatHeaderDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatEntryTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function EntryEditorDialog({
  open,
  title,
  form,
  categories,
  error,
  submitting,
  onFormChange,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  form: EntryFormState;
  categories: Array<{ id: number; name: string; workdayCode: string | null }>;
  error: string | null;
  submitting: boolean;
  onFormChange: (updater: (current: EntryFormState) => EntryFormState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label htmlFor="entry-category" className="mb-1 block text-sm font-medium">Category</label>
            <select
              id="entry-category"
              value={form.categoryId}
              onChange={(event) => onFormChange((current) => ({ ...current, categoryId: event.target.value }))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select a category</option>
              {categories.map((category) => (
                <option key={category.id} value={String(category.id)}>
                  {category.name}{category.workdayCode ? ` (${category.workdayCode})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="entry-start" className="mb-1 block text-sm font-medium">Start</label>
              <input
                id="entry-start"
                type="datetime-local"
                value={form.startLocal}
                onChange={(event) => onFormChange((current) => ({ ...current, startLocal: event.target.value }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="entry-end" className="mb-1 block text-sm font-medium">End</label>
              <input
                id="entry-end"
                type="datetime-local"
                value={form.endLocal}
                onChange={(event) => onFormChange((current) => ({ ...current, endLocal: event.target.value }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="entry-notes" className="mb-1 block text-sm font-medium">Notes</label>
            <textarea
              id="entry-notes"
              value={form.notes}
              onChange={(event) => onFormChange((current) => ({ ...current, notes: event.target.value }))}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Optional context for this entry"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={submitting || categories.length === 0}>
            {submitting ? 'Saving…' : 'Save entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DailyLogDialog({ open, date, onOpenChange, onDateChange }: Props) {
  const { data: entries = [], isLoading } = useEntries(date, open);
  const { data: categories = [] } = useCategories();
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();
  const deleteEntry = useDeleteEntry();

  const [editorOpen, setEditorOpen] = useState(false);
  const [entryBeingEdited, setEntryBeingEdited] = useState<TimeEntry | null>(null);
  const [entryPendingDelete, setEntryPendingDelete] = useState<TimeEntry | null>(null);
  const [form, setForm] = useState<EntryFormState>(() => buildDefaultForm(date));
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!editorOpen) {
      setForm(buildDefaultForm(date));
      setEntryBeingEdited(null);
      setFormError(null);
    }
  }, [date, editorOpen]);

  const sortedEntries = useMemo(
    () => [...entries].sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime()),
    [entries]
  );

  const totalMinutes = sortedEntries.reduce((sum, entry) => sum + elapsedMinutes(entry.startTime, entry.endTime), 0);
  const categoryCount = new Set(sortedEntries.map((entry) => entry.categoryId)).size;
  const runningCount = sortedEntries.filter((entry) => entry.endTime === null).length;

  function openCreateEditor() {
    setEntryBeingEdited(null);
    setForm(buildDefaultForm(date));
    setFormError(null);
    setEditorOpen(true);
  }

  function openEditEditor(entry: TimeEntry) {
    setEntryBeingEdited(entry);
    setForm(buildEditForm(entry));
    setFormError(null);
    setEditorOpen(true);
  }

  async function handleSaveEntry() {
    try {
      setFormError(null);

      if (!form.categoryId) {
        setFormError('Choose a category first.');
        return;
      }
      if (!form.startLocal || !form.endLocal) {
        setFormError('Start and end time are required.');
        return;
      }

      const payload = {
        categoryId: Number(form.categoryId),
        startTime: toIsoFromLocalDateTime(form.startLocal),
        endTime: toIsoFromLocalDateTime(form.endLocal),
        notes: form.notes.trim() ? form.notes.trim() : undefined,
      };

      if (entryBeingEdited) {
        await updateEntry.mutateAsync({ id: entryBeingEdited.id, dto: payload });
      } else {
        await createEntry.mutateAsync(payload);
      }

      setEditorOpen(false);
      setEntryBeingEdited(null);
      setForm(buildDefaultForm(date));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save entry.');
    }
  }

  async function handleDeleteEntry() {
    if (!entryPendingDelete) return;
    try {
      await deleteEntry.mutateAsync(entryPendingDelete.id);
      setEntryPendingDelete(null);
    } catch {
      // mutation error will surface through query/mutation tooling; keep dialog open state simple
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Daily log — {formatHeaderDate(date)}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onDateChange(shiftDate(date, -1))}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Prev day
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => onDateChange(shiftDate(date, 1))}>
                  Next day
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="day-log-date" className="text-sm font-medium">Date</label>
                <input
                  id="day-log-date"
                  type="date"
                  value={date}
                  onChange={(event) => onDateChange(event.target.value)}
                  className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total time</p>
                  <p className="mt-1 text-xl font-semibold">{formatDuration(totalMinutes)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Entries</p>
                  <p className="mt-1 text-xl font-semibold">{sortedEntries.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Categories</p>
                  <p className="mt-1 text-xl font-semibold">{categoryCount}</p>
                  {runningCount > 0 && <p className="mt-1 text-xs text-muted-foreground">{runningCount} running</p>}
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">Actual entries</h3>
                <p className="text-sm text-muted-foreground">
                  Edit totals from the Weekly grid, or use this log to inspect and repair the actual underlying entries.
                </p>
              </div>
              <Button type="button" onClick={openCreateEditor} disabled={categories.length === 0}>
                <Plus className="mr-2 h-4 w-4" />
                Add entry
              </Button>
            </div>

            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : sortedEntries.length === 0 ? (
              <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                No entries for this day yet. Add one to backfill missed work.
              </div>
            ) : (
              <div className="space-y-3">
                {sortedEntries.map((entry) => {
                  const category = categories.find((item) => item.id === entry.categoryId);
                  const isRunning = entry.endTime === null;
                  const duration = formatDuration(elapsedMinutes(entry.startTime, entry.endTime));

                  return (
                    <Card key={entry.id}>
                      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{category?.name ?? `Category #${entry.categoryId}`}</span>
                            {category?.workdayCode && (
                              <span className="text-xs text-muted-foreground">{category.workdayCode}</span>
                            )}
                            {isRunning && (
                              <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                                Running
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {formatEntryTime(entry.startTime)}
                            {entry.endTime ? ` → ${formatEntryTime(entry.endTime)}` : ' → still running'}
                            {' · '}
                            {duration}
                          </p>
                          {entry.notes && <p className="text-sm">{entry.notes}</p>}
                          {isRunning && (
                            <p className="text-xs text-muted-foreground">
                              Running entries are view-only here. Stop the timer from Track before editing the end time.
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 sm:justify-end">
                          <Button type="button" size="sm" variant="outline" onClick={() => openEditEditor(entry)} disabled={isRunning}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setEntryPendingDelete(entry)} disabled={isRunning}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <EntryEditorDialog
        open={editorOpen}
        title={entryBeingEdited ? 'Edit entry' : 'Add manual entry'}
        form={form}
        categories={categories}
        error={formError}
        submitting={createEntry.isPending || updateEntry.isPending}
        onFormChange={(updater) => setForm((current) => updater(current))}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveEntry}
      />

      <Dialog open={entryPendingDelete !== null} onOpenChange={(nextOpen) => !nextOpen && setEntryPendingDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete entry?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the selected entry from the day log and all related weekly/monthly summaries.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteEntry} disabled={deleteEntry.isPending}>
              {deleteEntry.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
