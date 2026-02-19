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
import type { Category } from '@time-keeper/shared';

// ── Preset colours ──────────────────────────────────────────────────────────
const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#06b6d4', '#a855f7', '#f43f5e',
];

// ── Form state ───────────────────────────────────────────────────────────────
interface FormState {
  name: string;
  color: string;
  workdayCode: string;
}
const defaultForm: FormState = { name: '', color: '#6366f1', workdayCode: '' };

// ── Sortable row ─────────────────────────────────────────────────────────────
interface SortableRowProps {
  cat: Category;
  onEdit: (cat: Category) => void;
  onDelete: (id: number) => void;
  deleteDisabled: boolean;
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="touch-none text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0"
        aria-label="Drag to reorder"
        tabIndex={-1}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Colour dot */}
      <span className="h-4 w-4 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />

      {/* Name + code */}
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{cat.name}</p>
        {cat.workdayCode && (
          <p className="text-xs text-muted-foreground truncate">{cat.workdayCode}</p>
        )}
      </div>

      {/* Actions */}
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

// ── CategoryManager ──────────────────────────────────────────────────────────
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

  // ── Drag sensors: pointer (mouse) + touch (mobile) ──────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  // ── Dialog helpers ───────────────────────────────────────────────────────
  function openCreate() {
    setForm(defaultForm);
    setDialog({ open: true });
  }

  function openEdit(cat: Category) {
    setForm({ name: cat.name, color: cat.color, workdayCode: cat.workdayCode ?? '' });
    setDialog({ open: true, editing: cat });
  }

  function handleSave() {
    const dto = {
      name: form.name.trim(),
      color: form.color,
      workdayCode: form.workdayCode.trim() || undefined,
    };
    if (dialog.editing) {
      update.mutate({ id: dialog.editing.id, dto });
    } else {
      create.mutate(dto);
    }
    setDialog({ open: false });
  }

  // ── Alphabetical sort ────────────────────────────────────────────────────
  function handleAlphaSort() {
    const nextDir = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDir(nextDir);

    const sorted = [...categories].sort((a, b) =>
      nextDir === 'asc'
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name)
    );

    // Optimistic update
    qc.setQueryData<Category[]>(['categories'], sorted);

    // Persist to server
    reorder.mutate(sorted.map((c, i) => ({ id: c.id, sortOrder: i })));
  }

  // ── Drag end ─────────────────────────────────────────────────────────────
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(categories, oldIndex, newIndex);

    // Reset alpha sort indicator when user manually drags
    setSortDir(null);

    // Optimistic update
    qc.setQueryData<Category[]>(['categories'], reordered);

    // Persist to server
    reorder.mutate(reordered.map((c, i) => ({ id: c.id, sortOrder: i })));
  }

  const isPending = create.isPending || update.isPending;

  return (
    <div className="space-y-4">
      {/* Header */}
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

      {/* Sortable list */}
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

      {/* Edit / Create dialog */}
      <Dialog open={dialog.open} onOpenChange={(o) => setDialog({ open: o })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog.editing ? 'Edit Category' : 'New Category'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Development"
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Workday code (optional)</label>
              <Input
                value={form.workdayCode}
                onChange={(e) => setForm((f) => ({ ...f, workdayCode: e.target.value }))}
                placeholder="e.g. IT-DEV-001"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Color</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className="h-8 w-8 rounded-full ring-offset-2 ring-offset-background transition-all"
                    style={{
                      backgroundColor: c,
                      outline: form.color === c ? `2px solid ${c}` : 'none',
                    }}
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false })}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || isPending}>
              {dialog.editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
