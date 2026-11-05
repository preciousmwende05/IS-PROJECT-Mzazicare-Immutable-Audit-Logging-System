/**
 * U-CS 74 — Care Visit Reporting & Feedback System
 * Owner(s): Marsa Fatuma Omar
 *
 * Mounted at /v1/reports. Care logs: what happened during a visit.
 *
 * Middleware order is ALWAYS:
 *   authMiddleware -> requireRole/requirePermission -> validate -> audit -> controller
 */

import { Router } from "express";

import { audit } from "@/shared/middleware/audit.middleware";
import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { reportController } from "@/modules/report-service/controllers/report.controller";
import { reportValidation } from "@/modules/report-service/validation/report.validation";

export const reportRoutes = Router();

// POST /visits/:visitId/care-log — the assigned caregiver records the visit.
// Audited as carelog.created (filed under the elder). Fields recorded: which
// measurements were taken, never their values.
reportRoutes.post(
  "/visits/:visitId/care-log",
  authMiddleware,
  validate(reportValidation.createCareLog),
  audit("carelog.created", (req) => ({
    elderId: req.res?.locals.elderId,
    visitId: req.params.visitId,
    recorded: Object.keys(req.body ?? {}),
  })),
  reportController.createCareLog,
);

// GET /visits/:visitId/care-log — the visit's care log (null until written).
// Every read is audited as carelog.viewed: care logs hold health data.
reportRoutes.get(
  "/visits/:visitId/care-log",
  authMiddleware,
  validate(reportValidation.byVisit),
  audit("carelog.viewed", (req) => ({ elderId: req.res?.locals.elderId, visitId: req.params.visitId })),
  reportController.getCareLog,
);

// GET /elders/:elderId/care-logs — an elder's care logs, newest first.
reportRoutes.get(
  "/elders/:elderId/care-logs",
  authMiddleware,
  validate(reportValidation.byElder),
  audit("carelog.viewed", (req) => ({ elderId: req.params.elderId, scope: "list" })),
  reportController.listForElder,
);
