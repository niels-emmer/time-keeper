import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { and, eq, ne } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import type { UserRow } from '../db/schema.js';
import { isSecureRequest } from './proxyTrust.js';

/**
 * Server-side sessions (plan D4, A3).
 *
 * The browser holds an opaque 32-byte id in the `tk_session` cookie; the
 * database stores only its SHA-256, so a database leak does not hand over live
 * sessions. Sessions are revocable by deleting the row — there is no signed
 * token that stays valid on its own.
 *
 * Lifetimes (Q7): 14-day idle window, slid forward on every verified request,
 * capped by a 90-day absolute deadline from creation.
 */

export const SESSION_COOKIE = 'tk_session';
export const SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
}

export interface CreatedSession {
  /** The raw id — goes to the browser and is never stored. */
  id: string;
  idHash: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
}

export interface VerifiedSession {
  session: typeof sessions.$inferSelect;
  user: UserRow;
}

export function hashSessionId(rawId: string): string {
  return createHash('sha256').update(rawId, 'utf8').digest('hex');
}

/**
 * Cookie attributes. `Secure` is derived from the request rather than hardcoded
 * so that local `AUTH_MODE=local` development over plain HTTP works, while
 * production is always `Secure` and a trusted proxy reporting `https` upgrades
 * a development cookie too (see `isSecureRequest`).
 */
export function sessionCookieOptions(req: Request): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_ABSOLUTE_MS,
  };
}

export function setSessionCookie(res: Response, req: Request, rawId: string): void {
  res.cookie(SESSION_COOKIE, rawId, sessionCookieOptions(req));
}

export function clearSessionCookie(res: Response, req: Request): void {
  // Same attributes as the live cookie, otherwise the browser keeps the old one.
  const { maxAge: _maxAge, ...options } = sessionCookieOptions(req);
  res.clearCookie(SESSION_COOKIE, options);
}

/**
 * Read the raw session id from the request cookie, if present.
 *
 * Parsed by hand rather than with `cookie-parser`: this is one name/value pair
 * out of a header we already control, and it avoids adding a dependency for it.
 */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() !== SESSION_COOKIE) {
      continue;
    }

    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }

  return undefined;
}

export interface CreateSessionInput {
  userId: string;
  userAgent?: string | null;
  ip?: string | null;
  now?: Date;
}

/**
 * Create a session and return the raw id. Callers must not log the return value.
 *
 * A fresh random id every time is what makes session fixation impossible: login
 * and privilege changes call this rather than reusing anything the client
 * presented.
 */
export function createSession(
  input: CreateSessionInput,
  database: AppDatabase = defaultDb
): CreatedSession {
  const now = input.now ?? new Date();
  const id = randomBytes(32).toString('base64url');
  const idHash = hashSessionId(id);

  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_IDLE_MS).toISOString();
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS).toISOString();

  database
    .insert(sessions)
    .values({
      idHash,
      userId: input.userId,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt,
      absoluteExpiresAt,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    })
    .run();

  return { id, idHash, userId: input.userId, createdAt, lastSeenAt: createdAt, expiresAt, absoluteExpiresAt };
}

/**
 * Resolve a raw session id to its session and user.
 *
 * Returns null — and deletes the row — when the session is past its idle or
 * absolute deadline, or when the account it belongs to is gone or disabled. A
 * revoked row simply is not found, so revocation takes effect on the next
 * request with no cache to wait out.
 */
export function verifySession(
  rawId: string,
  options: { now?: Date } = {},
  database: AppDatabase = defaultDb
): VerifiedSession | null {
  const now = options.now ?? new Date();
  const idHash = hashSessionId(rawId);

  const session = database.select().from(sessions).where(eq(sessions.idHash, idHash)).get();
  if (!session) {
    return null;
  }

  const expired =
    now.getTime() >= new Date(session.expiresAt).getTime() ||
    now.getTime() >= new Date(session.absoluteExpiresAt).getTime();

  if (expired) {
    database.delete(sessions).where(eq(sessions.idHash, idHash)).run();
    return null;
  }

  const user = database.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user || user.disabled) {
    database.delete(sessions).where(eq(sessions.idHash, idHash)).run();
    return null;
  }

  // Slide the idle window, never past the absolute deadline.
  const nextIdle = Math.min(
    now.getTime() + SESSION_IDLE_MS,
    new Date(session.absoluteExpiresAt).getTime()
  );

  database
    .update(sessions)
    .set({ lastSeenAt: now.toISOString(), expiresAt: new Date(nextIdle).toISOString() })
    .where(eq(sessions.idHash, idHash))
    .run();

  return { session, user };
}

/**
 * Replace a session with a new id for the same user: the old row is deleted
 * first, so the presented id is dead even if the new one is never delivered.
 * Used on login, on MFA completion and on password change (session fixation).
 */
export function rotateSession(
  rawId: string,
  input: { userAgent?: string | null; ip?: string | null; now?: Date } = {},
  database: AppDatabase = defaultDb
): CreatedSession | null {
  const verified = verifySession(rawId, { now: input.now }, database);
  if (!verified) {
    return null;
  }

  revokeSession(rawId, database);
  return createSession({ userId: verified.user.id, ...input }, database);
}

export function revokeSession(rawId: string, database: AppDatabase = defaultDb): void {
  database.delete(sessions).where(eq(sessions.idHash, hashSessionId(rawId))).run();
}

/** Revoke every session for a user, optionally sparing the caller's own. */
export function revokeAllSessions(
  userId: string,
  options: { exceptRawId?: string } = {},
  database: AppDatabase = defaultDb
): number {
  const condition = options.exceptRawId
    ? and(eq(sessions.userId, userId), ne(sessions.idHash, hashSessionId(options.exceptRawId)))
    : eq(sessions.userId, userId);

  const result = database.delete(sessions).where(condition).run();
  return result.changes;
}
