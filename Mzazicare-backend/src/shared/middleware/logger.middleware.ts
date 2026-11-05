import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import logger from "@/shared/config/logger";

/**
 * Gives every request a correlation id and logs its outcome. The same
 * requestId is echoed in error responses and written into the audit trail, so
 * one id traces a user action end to end.
 */
export function loggerMiddleware(req: Request, res: Response, next: NextFunction) {
  req.requestId = (req.headers["x-request-id"] as string) || randomUUID();
  res.setHeader("x-request-id", req.requestId);

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    logger.info(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms ` +
        `[${req.requestId}]${req.user ? ` user=${req.user.id}` : ""}`,
    );
  });

  next();
}
