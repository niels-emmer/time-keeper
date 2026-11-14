import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export interface AppError extends Error {
  statusCode?: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Reduce a Zod error to the two fields we are willing to expose: the field
 * path and the human-readable message.
 *
 * Zod 4 issues can carry the offending value (`issue.input`). That value is
 * user input and must never be echoed back to the client or written to logs,
 * so it is deliberately not copied here — and the raw `ZodError` is never
 * logged either.
 */
function toValidationIssues(err: ZodError): ValidationIssue[] {
  return err.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction): void {
  // Validation failures are client errors, not server faults (finding H-4).
  // Every route that calls `.parse()` inherits this: garbage input becomes a
  // 400 with stable, path-addressed detail instead of an opaque 500.
  if (err instanceof ZodError) {
    const issues = toValidationIssues(err);
    // Log path + message only. Never the request body or the issue's `input`.
    console.warn(
      `[validation] ${issues.map((issue) => `${issue.path || '(root)'}: ${issue.message}`).join('; ')}`
    );
    res.status(400).json({ error: 'Validation failed', issues });
    return;
  }

  const statusCode = err.statusCode ?? 500;
  const message = statusCode < 500 ? err.message : 'Internal server error';

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json({ error: message });
}

export function createError(message: string, statusCode: number): AppError {
  const err: AppError = new Error(message);
  err.statusCode = statusCode;
  return err;
}
