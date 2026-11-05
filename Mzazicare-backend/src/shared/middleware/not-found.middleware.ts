import type { NextFunction, Request, Response } from "express";

import { NotFoundError } from "@/shared/errors";

export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction) {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl}`));
}
