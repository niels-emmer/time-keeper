import { Router } from 'express';
import { eq, and, asc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { categories } from '../db/schema.js';
import { createError } from '../middleware/errorHandler.js';

export const categoriesRouter = Router();

const targetCadenceSchema = z.enum(['monthly', 'weekly', 'one_time']);
const targetMinutesSchema = z.number().int().min(1).max(525_600);

function withTargetValidation<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).superRefine((value, ctx) => {
    const hasTargetCadence = Object.prototype.hasOwnProperty.call(value, 'targetCadence');
    const hasTargetMinutes = Object.prototype.hasOwnProperty.call(value, 'targetMinutes');

    if (!hasTargetCadence && !hasTargetMinutes) {
      return;
    }

    const targetCadence = value.targetCadence;
    const targetMinutes = value.targetMinutes;

    if (targetCadence == null && targetMinutes == null) {
      return;
    }

    if (targetCadence == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetCadence'],
        message: 'targetCadence is required when targetMinutes is set.',
      });
    }

    if (targetMinutes == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetMinutes'],
        message: 'targetMinutes is required when targetCadence is set.',
      });
    }
  });
}

const createSchema = withTargetValidation({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  workdayCode: z.string().max(100).optional(),
  billable: z.boolean().optional(),
  targetCadence: targetCadenceSchema.nullable().optional(),
  targetMinutes: targetMinutesSchema.nullable().optional(),
});

const updateSchema = withTargetValidation({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  workdayCode: z.string().max(100).nullable().optional(),
  billable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  targetCadence: targetCadenceSchema.nullable().optional(),
  targetMinutes: targetMinutesSchema.nullable().optional(),
});

const reorderSchema = z.array(
  z.object({
    id: z.number().int(),
    sortOrder: z.number().int(),
  })
);

function buildTargetFields(
  incoming: { targetCadence?: 'monthly' | 'weekly' | 'one_time' | null; targetMinutes?: number | null },
  options?: { existingCadence: 'monthly' | 'weekly' | 'one_time' | null; existingStartedAt: string | null; now?: string }
) {
  const hasTargetCadence = Object.prototype.hasOwnProperty.call(incoming, 'targetCadence');
  const hasTargetMinutes = Object.prototype.hasOwnProperty.call(incoming, 'targetMinutes');

  if (!hasTargetCadence && !hasTargetMinutes) {
    return {};
  }

  const targetCadence = incoming.targetCadence ?? null;
  const targetMinutes = incoming.targetMinutes ?? null;

  if (targetCadence == null || targetMinutes == null) {
    return {
      targetCadence: null,
      targetMinutes: null,
      targetStartedAt: null,
    };
  }

  if (targetCadence === 'one_time') {
    return {
      targetCadence,
      targetMinutes,
      targetStartedAt:
        options?.existingCadence === 'one_time' && options.existingStartedAt
          ? options.existingStartedAt
          : (options?.now ?? new Date().toISOString()),
    };
  }

  return {
    targetCadence,
    targetMinutes,
    targetStartedAt: null,
  };
}

// List — ordered by sort_order ascending
categoriesRouter.get('/', (req, res, next) => {
  try {
    const rows = db
      .select()
      .from(categories)
      .where(eq(categories.userId, req.userId))
      .orderBy(asc(categories.sortOrder))
      .all();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Create — assign next sort_order value
categoriesRouter.post('/', (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const now = new Date().toISOString();

    // Place new category at the end of the list
    const maxRow = db
      .select({ maxOrder: sql<number>`COALESCE(MAX(sort_order), -1)` })
      .from(categories)
      .where(eq(categories.userId, req.userId))
      .get();
    const nextOrder = (maxRow?.maxOrder ?? -1) + 1;

    const result = db
      .insert(categories)
      .values({
        userId: req.userId,
        name: body.name,
        color: body.color,
        workdayCode: body.workdayCode,
        billable: body.billable,
        sortOrder: nextOrder,
        ...buildTargetFields(body, { existingCadence: null, existingStartedAt: null, now }),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// Update a single category
categoriesRouter.put('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw createError('Invalid id', 400);

    const body = updateSchema.parse(req.body);
    const now = new Date().toISOString();

    const existing = db
      .select({
        id: categories.id,
        targetCadence: categories.targetCadence,
        targetStartedAt: categories.targetStartedAt,
      })
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, req.userId)))
      .get();

    if (!existing) throw createError('Category not found', 404);

    const result = db
      .update(categories)
      .set({
        ...body,
        ...buildTargetFields(body, {
          existingCadence: existing.targetCadence,
          existingStartedAt: existing.targetStartedAt,
          now,
        }),
        updatedAt: now,
      })
      .where(and(eq(categories.id, id), eq(categories.userId, req.userId)))
      .returning()
      .get();

    if (!result) throw createError('Category not found', 404);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Bulk reorder — accepts [{ id, sortOrder }, ...]; runs in a transaction
categoriesRouter.patch('/reorder', (req, res, next) => {
  try {
    const items = reorderSchema.parse(req.body);

    db.transaction(() => {
      for (const { id, sortOrder } of items) {
        db.update(categories)
          .set({ sortOrder, updatedAt: new Date().toISOString() })
          .where(and(eq(categories.id, id), eq(categories.userId, req.userId)))
          .run();
      }
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Delete a category
categoriesRouter.delete('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw createError('Invalid id', 400);

    const result = db
      .delete(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, req.userId)))
      .returning()
      .get();

    if (!result) throw createError('Category not found', 404);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
