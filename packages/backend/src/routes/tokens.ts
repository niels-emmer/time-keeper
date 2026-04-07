import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { apiTokens } from '../db/schema.js';
import { requireHeaderAuth } from '../middleware/auth.js';

export const tokensRouter = Router();

// All token management endpoints require interactive (Authentik header) auth.
// A Bearer token cannot create, list, or revoke tokens — prevents privilege escalation.
tokensRouter.use(requireHeaderAuth);

const createSchema = z.object({
  label: z.string().min(1).max(64).trim(),
});

/** List all tokens for the current user. Never exposes the token hash. */
tokensRouter.get('/', (req, res) => {
  const rows = db
    .select({
      id: apiTokens.id,
      label: apiTokens.label,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, req.userId))
    .all();

  res.json(rows);
});

/**
 * Create a new token.
 * The raw token is returned ONCE in the response and is never stored.
 * Only the SHA-256 hash is stored in the database.
 */
tokensRouter.post('/', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    return;
  }

  const rawToken = randomBytes(32).toString('base64url'); // 256-bit, URL-safe, ~43 chars
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const [row] = db
    .insert(apiTokens)
    .values({
      userId: req.userId,
      tokenHash,
      label: parsed.data.label,
    })
    .returning({
      id: apiTokens.id,
      label: apiTokens.label,
      createdAt: apiTokens.createdAt,
    })
    .all();

  // token is returned ONCE — not stored, not retrievable again
  res.status(201).json({ ...row, token: rawToken });
});

/** Revoke (delete) a token. Only the owner can revoke their own tokens. */
tokensRouter.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid token id' });
    return;
  }

  const result = db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, req.userId)))
    .run();

  if (result.changes === 0) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }

  res.status(204).end();
});
