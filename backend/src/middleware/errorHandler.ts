import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  let statusCode = err instanceof ApiError ? err.statusCode : err.statusCode || 500;
  let message = err.message || 'Internal server error';

  // zod request validation -> 400 with a readable message
  if (err?.name === 'ZodError' && Array.isArray(err.issues)) {
    statusCode = 400;
    message = err.issues.slice(0, 3).map((i: any) => (i.path?.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
  }
  // Rules that block an action (e.g. completion needs evidence) carry a list of problems; show them in the message.
  if (err instanceof ApiError && Array.isArray((err.details as any)?.problems)) {
    message = `${message}: ${(err.details as any).problems.join(' ')}`;
  }
  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e: any) => e.message)
      .join(', ');
  }
  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = `${field ? field : 'Field'} already exists`;
  }
  // Mongoose cast error (bad ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for ${err.path}`;
  }

  if (statusCode >= 500) {
    logger.error({ err }, 'unhandled server error');
  }

  // Never leak internals for unexpected failures in hardened environments (SC-08).
  if (statusCode >= 500 && env.isHardened) message = 'Something went wrong. Please try again.';
  res.status(statusCode).json({
    success: false,
    message,
    requestId: (_req as any).id,
    details: err instanceof ApiError ? err.details : undefined,
    stack: env.appEnv === 'development' ? err.stack : undefined,
  });
}
