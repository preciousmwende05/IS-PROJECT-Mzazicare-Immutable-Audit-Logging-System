import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";

import logger from "@/shared/config/logger";
import { env } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

/**
 * The single place an error becomes an HTTP response. Registered last in
 * app.ts, and it must keep all four parameters — Express identifies error
 * middleware by arity, so dropping `_next` silently disables it.
 */
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let statusCode = 500;
  let code = "INTERNAL_ERROR";
  let message = "Something went wrong";
  let details: unknown;

  if (err instanceof AppError) {
    ({ statusCode, code, message, details } = err);
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 422;
    code = "VALIDATION_FAILED";
    message = "Invalid data";
    details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    code = "INVALID_ID";
    message = `Malformed value for "${err.path}"`;
  } else if (typeof err === "object" && err !== null && (err as { code?: number }).code === 11000) {
    statusCode = 409;
    code = "DUPLICATE";
    message = "A record with those details already exists";
  }

  if (statusCode >= 500) {
    logger.error(`[${req.requestId}] ${req.method} ${req.path} — ${(err as Error)?.stack ?? err}`);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      // Never leak internals to clients in production.
      details: statusCode >= 500 && env.NODE_ENV === "production" ? undefined : details,
    },
    requestId: req.requestId,
  });
}
