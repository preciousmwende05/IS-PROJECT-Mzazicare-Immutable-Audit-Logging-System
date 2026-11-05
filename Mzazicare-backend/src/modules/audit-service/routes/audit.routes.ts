/**
 * U-CS 78 — Immutable Audit Logging & Compliance System
 * Owner(s): Precious Mwende Waweru, Anthony Atenya
 */

import { Router } from "express";

import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { requireRole } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { audit } from "@/shared/middleware/audit.middleware";
import { auditController } from "@/modules/audit-service/controllers/audit.controller";
import { auditValidation } from "@/modules/audit-service/validation/audit.validation";

export const auditRoutes = Router();

auditRoutes.get(
  "/verify",
  authMiddleware,
  requireRole("admin", "auditor"),
  audit("audit.chain.verified", () => ({})),
  auditController.verify,
);

auditRoutes.get(
  "/",
  authMiddleware,
  requireRole("admin", "auditor"),
  validate(auditValidation.list),
  audit("audit.log.listed", () => ({})),
  auditController.list,
);

// The latest automatic integrity check (runs every 30 minutes).
auditRoutes.get(
  "/verification/latest",
  authMiddleware,
  requireRole("admin", "auditor"),
  auditController.lastVerification,
);

// Anomaly alerts: policy rules, the Isolation Forest, a broken chain.
auditRoutes.get(
  "/anomalies",
  authMiddleware,
  requireRole("admin", "auditor"),
  validate(auditValidation.anomalies),
  auditController.anomalies,
);

auditRoutes.post(
  "/anomalies/:id/resolve",
  authMiddleware,
  requireRole("admin", "auditor"),
  validate(auditValidation.resolveAnomaly),
  audit("audit.anomaly.resolved", (req) => ({ anomalyId: req.params.id })),
  auditController.resolveAnomaly,
);

// Last: the catch-all sequence lookup.
auditRoutes.get(
  "/:sequence",
  authMiddleware,
  requireRole("admin", "auditor"),
  validate(auditValidation.bySequence),
  audit("audit.entry.viewed", (req) => ({ sequence: req.params.sequence })),
  auditController.getBySequence,
);


/**
 * TODO(audit): declare the endpoints owned by U-CS 78.
 *
 * Middleware order is ALWAYS:
 *   authMiddleware -> requireRole/requirePermission -> validate -> audit -> controller
 *
 * import { authMiddleware } from "@/shared/middleware/auth.middleware";
 * import { requirePermission } from "@/shared/middleware/role.middleware";
 * import { validate } from "@/shared/middleware/validate.middleware";
 * import { audit } from "@/shared/middleware/audit.middleware";
 * import { auditController } from "@/modules/audit-service/controllers/audit.controller";
 * import { auditValidation } from "@/modules/audit-service/validation/audit.validation";
 *
 * auditRoutes.get("/", authMiddleware, validate(auditValidation.list), auditController.list);
 *
 * auditRoutes.post(
 *   "/",
 *   authMiddleware,
 *   requirePermission("audits:create"),
 *   validate(auditValidation.create),
 *   audit("audit.created", (req) => ({ id: req.params.id })),
 *   auditController.create,
 * );
 */
