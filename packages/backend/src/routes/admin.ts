import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireFreshSession } from '../middleware/auth.js';
import {
  EMAIL_TAKEN_MESSAGE,
  LAST_ADMIN_MESSAGE,
  USERNAME_FORMAT_MESSAGE,
  USERNAME_TAKEN_MESSAGE,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  listAuthEvents,
  pruneAuthEvents,
  serializeAdminUser,
  updateAdminUser,
} from '../services/adminService.js';
import { recordAuthEvent } from '../services/authService.js';
import { createInvite } from '../services/inviteService.js';
import { issueResetCode } from '../services/resetService.js';
import { findUserByEmail } from '../services/userService.js';

/**
 * Admin surface (plan §5, Q11, Q16, Phase E).
 *
 * Every route sits behind `requireAdmin`, which answers **404** rather than 403
 * for a non-admin so the surface is not discoverable, and which fails closed
 * with `mfa_enrolment_required` when a local administrator has not enrolled MFA
 * (Q8, Phase D).
 *
 * Mutations additionally require a session established within the last five
 * minutes (Q17: role change and account deletion are named sensitive actions).
 * Proxy-header identities are allowed through by `requireFreshSession` because
 * Authentik re-authenticates every hop.
 *
 * Target scale is 2–10 users: no bulk operations, no cross-user session
 * administration, no force-MFA-reset (Q11).
 */

const EMAIL_MAX_LENGTH = 320;

const emailField = z
  .string()
  .trim()
  .min(3)
  .max(EMAIL_MAX_LENGTH)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.');

const usernameField = z.string().trim().min(3).max(32);

const createInviteSchema = z.object({
  email: emailField.optional(),
  role: z.enum(['user', 'admin']).optional(),
});

const createUserSchema = z.object({
  email: emailField,
  username: usernameField,
  role: z.enum(['user', 'admin']).default('user'),
});

const updateUserSchema = z
  .object({
    role: z.enum(['user', 'admin']).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((value) => value.role !== undefined || value.disabled !== undefined, {
    message: 'Supply role and/or disabled.',
    path: ['role'],
  });

const deleteUserSchema = z.object({
  mode: z.enum(['cascade', 'reassign']),
});

const listEventsSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function requestIp(req: import('express').Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

export const adminRouter = Router();

adminRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

adminRouter.use(requireAdmin);

// ---------------------------------------------------------------------------
// Users (Q11, Q16)
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/users
 *
 * The user table plus an entry count. Explicit allowlist: password hashes, MFA
 * secrets and recovery codes never appear here.
 */
adminRouter.get('/users', (_req, res, next) => {
  try {
    res.json({
      users: listAdminUsers(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/users
 *
 * Creates the account with an unusable password and returns a 60-minute,
 * single-use reset code exactly once. The administrator hands it over out of
 * band; there is no SMTP and no temporary password (D5).
 */
adminRouter.post('/users', requireFreshSession, (req, res, next) => {
  try {
    const payload = createUserSchema.parse(req.body ?? {});

    const outcome = createAdminUser({
      email: payload.email,
      username: payload.username,
      role: payload.role,
      actorId: req.userId,
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
    });

    switch (outcome.status) {
      case 'username_invalid':
        res.status(400).json({ error: USERNAME_FORMAT_MESSAGE, code: 'username_invalid' });
        return;
      case 'email_taken':
        res.status(409).json({ error: EMAIL_TAKEN_MESSAGE, code: 'email_taken' });
        return;
      case 'username_taken':
        res.status(409).json({ error: USERNAME_TAKEN_MESSAGE, code: 'username_taken' });
        return;
      case 'ok':
        pruneAuthEvents();
        res.status(201).json({
          user: serializeAdminUser(outcome.user),
          resetCode: outcome.resetCode,
          resetExpiresAt: outcome.resetExpiresAt,
        });
        return;
    }
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/admin/users/:id
 *
 * Role change and disable/enable. The last enabled administrator can be
 * neither demoted nor disabled; disabling revokes the account's sessions
 * immediately (proven by an integration test with a real session).
 */
adminRouter.patch('/users/:id', requireFreshSession, (req, res, next) => {
  try {
    const payload = updateUserSchema.parse(req.body ?? {});

    const outcome = updateAdminUser({
      targetId: req.params.id,
      actorId: req.userId,
      role: payload.role,
      disabled: payload.disabled,
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
    });

    switch (outcome.status) {
      case 'not_found':
        res.status(404).json({ error: 'User not found.' });
        return;
      case 'last_admin':
        res.status(409).json({ error: LAST_ADMIN_MESSAGE, code: 'last_admin' });
        return;
      case 'ok':
        pruneAuthEvents();
        res.json({ user: serializeAdminUser(outcome.user) });
        return;
    }
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/admin/users/:id
 *
 * Q16: the body must say `cascade` or `reassign`. `reassign` moves the
 * account's time entries to the calling administrator and resolves category
 * name collisions; `cascade` removes every user-scoped row. Neither leaves
 * orphans, and the last enabled administrator cannot be deleted.
 */
adminRouter.delete('/users/:id', requireFreshSession, (req, res, next) => {
  try {
    const payload = deleteUserSchema.parse(req.body ?? {});

    const outcome = deleteAdminUser({
      targetId: req.params.id,
      actorId: req.userId,
      mode: payload.mode,
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
    });

    switch (outcome.status) {
      case 'not_found':
        res.status(404).json({ error: 'User not found.' });
        return;
      case 'last_admin':
        res.status(409).json({ error: LAST_ADMIN_MESSAGE, code: 'last_admin' });
        return;
      case 'open_timer_conflict':
        res.status(409).json({
          error:
            'Both accounts have a running timer. Stop one of them before reassigning entries.',
          code: 'open_timer_conflict',
        });
        return;
      case 'ok':
        pruneAuthEvents();
        res.json({ deleted: true, ...outcome.result });
        return;
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/users/:id/reset
 *
 * Issues a fresh 60-minute single-use reset code and invalidates any earlier
 * one. The raw code is returned once; only its hash is stored. An audit row is
 * written by `issueResetCode` with the acting administrator as the actor.
 */
adminRouter.post('/users/:id/reset', requireFreshSession, (req, res, next) => {
  try {
    const issued = issueResetCode({
      userId: req.params.id,
      actorId: req.userId,
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
    });

    if (!issued) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    pruneAuthEvents();
    res.json({ resetCode: issued.code, expiresAt: issued.expiresAt });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Invites (Phase C, retained here)
// ---------------------------------------------------------------------------

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
      ip: requestIp(req),
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

// ---------------------------------------------------------------------------
// Audit viewer (Q12)
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/auth-events?page=1&limit=50
 *
 * Newest first, with the acting account resolved when it still exists. The
 * 90-day retention prune runs on every read, so an install with no scheduler
 * still cannot accumulate audit rows without bound.
 */
adminRouter.get('/auth-events', (req, res, next) => {
  try {
    const payload = listEventsSchema.parse(req.query ?? {});
    pruneAuthEvents();

    res.json(
      listAuthEvents({
        page: payload.page,
        limit: payload.limit,
      })
    );
  } catch (error) {
    next(error);
  }
});
