/**
 * Consent & Data Rights — mounted at /v1/privacy.
 *
 * Every write, and every read of the access history, is audited and filed
 * under the elder, so it shows up in the elder's own access history.
 *
 * Middleware order is ALWAYS:
 *   authMiddleware -> requireRole/requirePermission -> validate -> audit -> controller
 */

import { Router } from "express";

import { audit } from "@/shared/middleware/audit.middleware";
import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { requireRole } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { consentController } from "@/modules/consent-service/controllers/consent.controller";
import { consentValidation } from "@/modules/consent-service/validation/consent.validation";

export const consentRoutes = Router();

// ---------------- per elder (family / elder / staff) ----------------

consentRoutes.get(
  "/elders/:elderId/consent",
  authMiddleware,
  validate(consentValidation.byElder),
  consentController.getConsent,
);

// "Share my care plan with caregivers": consent.granted or consent.withdrawn.
consentRoutes.put(
  "/elders/:elderId/consent",
  authMiddleware,
  validate(consentValidation.setConsent),
  audit(
    (req) => (req.body.granted ? "consent.granted" : "consent.withdrawn"),
    (req) => ({ elderId: req.params.elderId, purpose: "careplan_sharing" }),
  ),
  consentController.setConsent,
);

// "Who accessed my data": from the audit log.
consentRoutes.get(
  "/elders/:elderId/access-log",
  authMiddleware,
  validate(consentValidation.accessLog),
  audit("privacy.accesslog.viewed", (req) => ({ elderId: req.params.elderId })),
  consentController.accessLog,
);

// Download a copy (the service also records datarequest.submitted).
consentRoutes.post(
  "/elders/:elderId/export",
  authMiddleware,
  validate(consentValidation.byElder),
  audit("datarequest.completed", (req) => ({ elderId: req.params.elderId, type: "export" })),
  consentController.exportData,
);

consentRoutes.post(
  "/elders/:elderId/deletion-requests",
  authMiddleware,
  validate(consentValidation.requestDeletion),
  audit("datarequest.submitted", (req) => ({
    elderId: req.params.elderId,
    type: "deletion",
    requestId: req.res?.locals.requestId,
  })),
  consentController.requestDeletion,
);

consentRoutes.get(
  "/elders/:elderId/data-requests",
  authMiddleware,
  validate(consentValidation.byElder),
  consentController.requestsForElder,
);

// ---------------- admin review ----------------

const admin = [authMiddleware, requireRole("admin")];

consentRoutes.get("/data-requests", ...admin, validate(consentValidation.listRequests), consentController.listRequests);

consentRoutes.get("/data-requests/:id", ...admin, validate(consentValidation.byRequest), consentController.getRequest);

consentRoutes.post(
  "/data-requests/:id/review",
  ...admin,
  validate(consentValidation.byRequest),
  audit("datarequest.reviewed", (req) => ({ elderId: req.res?.locals.elderId, requestId: req.params.id })),
  consentController.review,
);

// Approve (erase) -> datarequest.completed; refuse -> datarequest.refused.
consentRoutes.post(
  "/data-requests/:id/decision",
  ...admin,
  validate(consentValidation.decide),
  audit(
    (req) => (req.body.decision === "approve" ? "datarequest.completed" : "datarequest.refused"),
    (req) => ({ elderId: req.res?.locals.elderId, requestId: req.params.id, type: "deletion", decision: req.body.decision }),
  ),
  consentController.decide,
);
