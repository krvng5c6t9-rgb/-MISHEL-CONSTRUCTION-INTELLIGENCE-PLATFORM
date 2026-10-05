import type { ErrorRequestHandler, RequestHandler } from 'express';
import crypto from 'node:crypto';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, error: err.message, details: err.details });
    return;
  }

  // CC-013: PostgreSQL errors carry a SQLSTATE `code`. Deterministic client-caused
  // failures (constraint, trigger business rule, RLS, bad input) map to 4xx with a safe
  // message. Anything else is a server fault: log it with a reference id and return a
  // generic message so SQL/schema details never reach the client.
  const pgCode = typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) ? err.code as string : null;
  const mapped = pgCode ? mapPgError(pgCode, err) : null;
  if (mapped) {
    res.status(mapped.status).json({ success: false, error: mapped.message, code: pgCode });
    return;
  }

  const ref = crypto.randomUUID();
  console.error(JSON.stringify({ level: 'error', ref, message: err?.message, code: pgCode, stack: err?.stack }));
  res.status(500).json({ success: false, error: 'Internal server error', ref });
};

function mapPgError(code: string, err: { message?: string; constraint?: string }) {
  switch (code) {
    // Business rules raised by triggers/functions (RAISE EXCEPTION): authored messages, safe to show.
    case 'P0001': return { status: 422, message: err.message ?? 'Business rule violation' };
    case '23505': return { status: 409, message: `Duplicate value violates unique constraint${err.constraint ? ` ${err.constraint}` : ''}` };
    case '23503': return { status: 422, message: 'Referenced record does not exist or is still referenced' };
    case '23502': return { status: 422, message: 'A required value is missing' };
    case '23514': return { status: 422, message: `Value violates check constraint${err.constraint ? ` ${err.constraint}` : ''}` };
    case '23P01': return { status: 409, message: 'Value conflicts with an existing record' };
    case '42501': return { status: 403, message: 'Not permitted for the current organization' };
    case '22P02': case '22007': case '22008': case '22003': case '22001':
      return { status: 400, message: 'Invalid input value' };
    case '40001': case '40P01': return { status: 409, message: 'Concurrent update conflict; retry the request' };
    default: return null;
  }
}
