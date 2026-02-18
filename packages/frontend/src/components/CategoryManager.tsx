import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory } from '@/hooks/useCategories';
import type { Category } from '@time-keeper/shared';

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#06b6d4', '#a855f7', '#f43f5e',
];

interface FormState {
  name: string;
  color: string;
  workdayCode: string;
}

const defaultForm: FormState = { name: '', color: '#6366f1', workdayCode: '' };

export function CategoryManager() {
  const { data: categories = [] } = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const del = useDeleteCategory();

  const [dialog, setDialog] = useState<{ open: boolean; editing?: Category }>({ open: false });
  const [form, setForm] = useState<FormState>(defaultForm);

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

  const isPending = create.isPending || update.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Categories</h2>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </div>

      <div className="space-y-2">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
          >
            <span
              className="h-4 w-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: cat.color }}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{cat.name}</p>
              {cat.workdayCode && (
                <p className="text-xs text-muted-foreground truncate">{cat.workdayCode}</p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={() => openEdit(cat)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => del.mutate(cat.id)}
              disabled={del.isPending}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        {categories.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No categories yet — add one to get started.
          </p>
        )}
      </div>

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
