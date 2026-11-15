import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { recordAuthEvent } from '../services/authService.js';
import { createInvite } from '../services/inviteService.js';
import { findUserByEmail } from '../services/userService.js';

/**
 * Admin surface (plan §5, Phase C slice).
 *
 * Phase C builds exactly one admin endpoint — invite issuance — because
 * registration by invite cannot be exercised without a way to mint an invite.
 * The rest of the admin API and its UI belong to Phase E; nothing here should
 * grow into that by accident.
 *
 * `requireAdmin` answers **404**, never 403, so a non-admin cannot discover
 * that this surface exists.
 */

const EMAIL_MAX_LENGTH = 320;

const createInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(EMAIL_MAX_LENGTH)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.')
    .optional(),
  role: z.enum(['user', 'admin']).optional(),
});

export const adminRouter = Router();

adminRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

adminRouter.use(requireAdmin);

/**
 * POST /api/admin/invites
 *
 * Returns the raw token exactly once; only its SHA-256 is stored, so it cannot
 * be recovered from the database later. There is no mail stack (D5), so the
 * caller hands the link over out of band.
 */
adminRouter.post('/invites', (req, res, next) => {
  try {
    const payload = createInviteSchema.parse(req.body ?? {});
    const email = payload.email ? payload.email.trim().toLowerCase() : null;

    if (email && findUserByEmail(email)) {
      res.status(409).json({
        error: 'An account with that email already exists.',
        code: 'email_taken',
      });
      return;
    }

    const { invite, token } = createInvite({
      email,
      role: payload.role ?? 'user',
      createdBy: req.userId,
    });

    recordAuthEvent({
      userId: req.userId,
      kind: 'invite_created',
      ip: req.ip ?? req.socket?.remoteAddress ?? null,
      userAgent: req.get('user-agent') ?? null,
      meta: { inviteId: invite.id, role: invite.role, email: invite.email },
    });

    res.status(201).json({
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
      token,
      /** Convenience for whoever hands the link over. */
      acceptPath: `/register?token=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    next(error);
  }
});
