/**
 * U-CS 77 — Care Operations Monitoring & Control System
 * Owner(s): Samuel Kahiga, Wachira Peter Githinji
 */

import { Router } from "express";

export const operationsRoutes = Router();

/**
 * TODO(operations): declare the endpoints owned by U-CS 77.
 *
 * Middleware order is ALWAYS:
 *   authMiddleware -> requireRole/requirePermission -> validate -> audit -> controller
 *
 * import { authMiddleware } from "@/shared/middleware/auth.middleware";
 * import { requirePermission } from "@/shared/middleware/role.middleware";
 * import { validate } from "@/shared/middleware/validate.middleware";
 * import { audit } from "@/shared/middleware/audit.middleware";
 * import { operationsController } from "@/modules/operations-service/controllers/operations.controller";
 * import { operationsValidation } from "@/modules/operations-service/validation/operations.validation";
 *
 * operationsRoutes.get("/", authMiddleware, validate(operationsValidation.list), operationsController.list);
 *
 * operationsRoutes.post(
 *   "/",
 *   authMiddleware,
 *   requirePermission("operationss:create"),
 *   validate(operationsValidation.create),
 *   audit("operations.created", (req) => ({ id: req.params.id })),
 *   operationsController.create,
 * );
 */
