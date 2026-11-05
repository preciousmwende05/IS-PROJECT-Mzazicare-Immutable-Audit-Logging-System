/**
 * U-CS 75 — Care Services Payment & Billing System
 * Owner(s): Mukabwa Gloria Joy, Getenga Jarvis Mokaya
 */

import { Router } from "express";

export const billingRoutes = Router();

/**
 * TODO(billing): declare the endpoints owned by U-CS 75.
 *
 * Middleware order is ALWAYS:
 *   authMiddleware -> requireRole/requirePermission -> validate -> audit -> controller
 *
 * import { authMiddleware } from "@/shared/middleware/auth.middleware";
 * import { requirePermission } from "@/shared/middleware/role.middleware";
 * import { validate } from "@/shared/middleware/validate.middleware";
 * import { audit } from "@/shared/middleware/audit.middleware";
 * import { billingController } from "@/modules/billing-service/controllers/billing.controller";
 * import { billingValidation } from "@/modules/billing-service/validation/billing.validation";
 *
 * billingRoutes.get("/", authMiddleware, validate(billingValidation.list), billingController.list);
 *
 * billingRoutes.post(
 *   "/",
 *   authMiddleware,
 *   requirePermission("billings:create"),
 *   validate(billingValidation.create),
 *   audit("billing.created", (req) => ({ id: req.params.id })),
 *   billingController.create,
 * );
 */
