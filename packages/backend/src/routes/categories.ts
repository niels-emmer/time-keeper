import { Router } from 'express';
import { eq, and, asc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { categories } from '../db/schema.js';
import { createError } from '../middleware/errorHandler.js';

export const categoriesRouter = Router();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  workdayCode: z.string().max(100).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  workdayCode: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const reorderSchema = z.array(
  z.object({
    id: z.number().int(),
    sortOrder: z.number().int(),
  })
);

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
      .values({ userId: req.userId, ...body, sortOrder: nextOrder, createdAt: now, updatedAt: now })
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

    const result = db
      .update(categories)
      .set({ ...body, updatedAt: now })
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
