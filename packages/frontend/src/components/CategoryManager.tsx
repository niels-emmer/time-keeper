import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Pencil, Trash2, GripVertical, ArrowDownAZ, ArrowUpZA } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useReorderCategories,
} from '@/hooks/useCategories';
import { useQueryClient } from '@tanstack/react-query';
import type { Category, CategoryTargetCadence } from '@time-keeper/shared';

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#06b6d4', '#a855f7', '#f43f5e',
];

interface FormState {
  name: string;
  color: string;
  workdayCode: string;
  billable: boolean;
  targetCadence: CategoryTargetCadence | null;
  targetHours: number;
  targetMinutes: number;
}

const defaultForm: FormState = {
  name: '',
  color: '#6366f1',
  workdayCode: '',
  billable: false,
  targetCadence: null,
  targetHours: 0,
  targetMinutes: 0,
};

interface SortableRowProps {
  cat: Category;
  onEdit: (cat: Category) => void;
  onDelete: (id: number) => void;
  deleteDisabled: boolean;
}

function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function getTargetCadenceLabel(targetCadence: CategoryTargetCadence | null) {
  switch (targetCadence) {
    case 'monthly':
      return 'Monthly';
    case 'weekly':
      return 'Weekly';
    case 'one_time':
      return 'One-time';
    default:
      return 'No target';
  }
}

function getTargetHelperText(targetCadence: CategoryTargetCadence | null) {
  switch (targetCadence) {
    case 'monthly':
      return 'Used directly as this category\'s monthly target on the Monthly tab.';
    case 'weekly':
      return 'Converted into a month-specific target based on the number of days in the viewed month.';
    case 'one_time':
      return 'Tracks a single budget from the day you set it. It does not reset next month and can go negative to show overruns.';
    default:
      return 'Leave blank if this category should not have a target.';
  }
}

function getCategoryTargetSummary(category: Category) {
  if (!category.targetCadence || category.targetMinutes == null) {
    return null;
  }

  return `${getTargetCadenceLabel(category.targetCadence)} target • ${formatDuration(category.targetMinutes)}`;
}

function SortableRow({ cat, onEdit, onDelete, deleteDisabled }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cat.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const targetSummary = getCategoryTargetSummary(cat);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
    >
      <button
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab flex-shrink-0 text-muted-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
        tabIndex={-1}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="h-4 w-4 flex-shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{cat.name}</p>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {cat.workdayCode && <p className="truncate">{cat.workdayCode}</p>}
          {targetSummary && <p className="truncate">{targetSummary}</p>}
        </div>
      </div>

      {cat.billable && (
        <span className="flex-shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
          billable
        </span>
      )}

      <Button variant="ghost" size="icon" onClick={() => onEdit(cat)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onDelete(cat.id)}
        disabled={deleteDisabled}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function toFormState(category?: Category): FormState {
  if (!category) {
    return defaultForm;
  }

  const totalTargetMinutes = category.targetMinutes ?? 0;

  return {
    name: category.name,
    color: category.color,
    workdayCode: category.workdayCode ?? '',
    billable: category.billable,
    targetCadence: category.targetCadence ?? null,
    targetHours: Math.floor(totalTargetMinutes / 60),
    targetMinutes: totalTargetMinutes % 60,
  };
}

export function CategoryManager() {
  const { data: categories = [] } = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const del = useDeleteCategory();
  const reorder = useReorderCategories();
  const qc = useQueryClient();

  const [dialog, setDialog] = useState<{ open: boolean; editing?: Category }>({ open: false });
  const [form, setForm] = useState<FormState>(defaultForm);
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  function openCreate() {
    setForm(defaultForm);
    setDialog({ open: true });
  }

  function openEdit(cat: Category) {
    setForm(toFormState(cat));
    setDialog({ open: true, editing: cat });
  }

  function handleTargetHoursChange(value: string) {
    const next = Math.max(0, Number.parseInt(value || '0', 10) || 0);
    setForm((current) => ({ ...current, targetHours: next }));
  }

  function handleTargetMinutesChange(value: string) {
    const next = Math.max(0, Math.min(59, Number.parseInt(value || '0', 10) || 0));
    setForm((current) => ({ ...current, targetMinutes: next }));
  }

  function handleTargetCadenceChange(targetCadence: CategoryTargetCadence | null) {
    setForm((current) => ({
      ...current,
      targetCadence,
      targetHours: targetCadence ? current.targetHours : 0,
      targetMinutes: targetCadence ? current.targetMinutes : 0,
    }));
  }

  function handleSave() {
    const totalTargetMinutes = form.targetCadence ? (form.targetHours * 60) + form.targetMinutes : null;
    const trimmedWorkdayCode = form.workdayCode.trim();

    if (dialog.editing) {
      update.mutate({
        id: dialog.editing.id,
        dto: {
          name: form.name.trim(),
          color: form.color,
          workdayCode: trimmedWorkdayCode || null,
          billable: form.billable,
          targetCadence: form.targetCadence,
          targetMinutes: totalTargetMinutes,
        },
      });
    } else {
      create.mutate({
        name: form.name.trim(),
        color: form.color,
        workdayCode: trimmedWorkdayCode || undefined,
        billable: form.billable,
        targetCadence: form.targetCadence,
        targetMinutes: totalTargetMinutes,
      });
    }
    setDialog({ open: false });
  }

  function handleAlphaSort() {
    const nextDir = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDir(nextDir);

    const sorted = [...categories].sort((a, b) =>
      nextDir === 'asc'
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name)
    );

    qc.setQueryData<Category[]>(['categories'], sorted);
    reorder.mutate(sorted.map((c, i) => ({ id: c.id, sortOrder: i })));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(categories, oldIndex, newIndex);

    setSortDir(null);
    qc.setQueryData<Category[]>(['categories'], reordered);
    reorder.mutate(reordered.map((c, i) => ({ id: c.id, sortOrder: i })));
  }

  const isPending = create.isPending || update.isPending;
  const hasValidTarget = form.targetCadence === null || ((form.targetHours * 60) + form.targetMinutes) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Categories</h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleAlphaSort}
            aria-label={sortDir === 'asc' ? 'Sort Z→A' : 'Sort A→Z'}
            title={sortDir === 'asc' ? 'Sort Z→A' : 'Sort A→Z'}
          >
            {sortDir === 'asc'
              ? <ArrowUpZA className="h-4 w-4" />
              : <ArrowDownAZ className="h-4 w-4" />
            }
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {categories.map((cat) => (
              <SortableRow
                key={cat.id}
                cat={cat}
                onEdit={openEdit}
                onDelete={(id) => del.mutate(id)}
                deleteDisabled={del.isPending}
              />
            ))}
            {categories.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No categories yet — add one to get started.
              </p>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <Dialog open={dialog.open} onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog.editing ? 'Edit Category' : 'New Category'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                placeholder="e.g. Development"
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Workday code (optional)</label>
              <Input
                value={form.workdayCode}
                onChange={(e) => setForm((current) => ({ ...current, workdayCode: e.target.value }))}
                placeholder="e.g. IT-DEV-001"
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                id="billable-toggle"
                type="checkbox"
                checked={form.billable}
                onChange={(e) => setForm((current) => ({ ...current, billable: e.target.checked }))}
                className="h-4 w-4 rounded border-input accent-amber-500"
              />
              <label htmlFor="billable-toggle" className="cursor-pointer text-sm font-medium">
                Billable activity
              </label>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Color</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="h-8 w-8 rounded-full ring-offset-2 ring-offset-background transition-all"
                    style={{
                      backgroundColor: color,
                      outline: form.color === color ? `2px solid ${color}` : 'none',
                    }}
                    onClick={() => setForm((current) => ({ ...current, color }))}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-card px-4 py-3 text-sm">
              <div>
                <span className="font-medium">Target hours</span>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Optional. Configure a monthly target, weekly target, or one-time budget for this category.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  { value: null, label: 'None' },
                  { value: 'monthly', label: 'Per month' },
                  { value: 'weekly', label: 'Per week' },
                  { value: 'one_time', label: 'One-time' },
                ] as const).map((option) => {
                  const isSelected = form.targetCadence === option.value;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => handleTargetCadenceChange(option.value)}
                      className={[
                        'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background text-muted-foreground hover:bg-muted',
                      ].join(' ')}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              {form.targetCadence && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Hours</label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={form.targetHours}
                        onChange={(event) => handleTargetHoursChange(event.target.value)}
                        placeholder="e.g. 20"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Minutes</label>
                      <Input
                        type="number"
                        min="0"
                        max="59"
                        step="1"
                        value={form.targetMinutes}
                        onChange={(event) => handleTargetMinutesChange(event.target.value)}
                        placeholder="0–59"
                      />
                    </div>
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      {getTargetCadenceLabel(form.targetCadence)} target • {formatDuration((form.targetHours * 60) + form.targetMinutes)}
                    </p>
                    <p>{getTargetHelperText(form.targetCadence)}</p>
                    {dialog.editing?.targetCadence === 'one_time' && dialog.editing.targetStartedAt && form.targetCadence === 'one_time' && (
                      <p>Budget started on {dialog.editing.targetStartedAt.slice(0, 10)}.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false })}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || !hasValidTarget || isPending}>
              {dialog.editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
