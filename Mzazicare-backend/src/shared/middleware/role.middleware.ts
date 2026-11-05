import type { NextFunction, Request, Response } from "express";

import { ForbiddenError, UnauthorizedError } from "@/shared/errors";
import { PERMISSIONS_BY_ROLE, type Permission } from "@/shared/middleware/permissions";
import type { Role } from "@/shared/types";

/**
 * Route guards. Always placed after authMiddleware.
 *
 *   router.post("/", authMiddleware, requireRole("coordinator", "admin"), ctrl.create);
 */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError(`Requires one of: ${roles.join(", ")}`));
    }
    return next();
  };

export const requirePermission =
  (...permissions: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError());
    const held = PERMISSIONS_BY_ROLE[req.user.role] ?? [];
    const missing = permissions.filter((p) => !held.includes(p));
    if (missing.length)
      return next(new ForbiddenError(`Missing permission: ${missing.join(", ")}`));
    return next();
  };

/**
 * Ownership ("is this elder in *my* family?") is a data question, not a role
 * question. Answer it in the service, where the relationship is known. This
 * middleware only answers "what may this role do at all".
 */
