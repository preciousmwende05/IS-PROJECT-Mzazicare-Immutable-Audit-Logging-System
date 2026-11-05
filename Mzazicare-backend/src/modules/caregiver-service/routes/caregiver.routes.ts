import { Router } from "express";

import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { requirePermission, requireRole } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { audit } from "@/shared/middleware/audit.middleware";
import { caregiverController } from "@/modules/caregiver-service/controllers/caregiver.controller";
import { caregiverValidation } from "@/modules/caregiver-service/validation/caregiver.validation";

export const caregiverRoutes = Router();

/*
 * Middleware order: authMiddleware -> requirePermission -> validate -> audit -> controller.
 *
 * KYC files never pass through the API. The client asks for a presigned URL
 * (POST /me/documents/upload-url), PUTs the file straight to RustFS, then registers
 * it by key (POST /me/documents), where its size and type are checked.
 *
 * Static paths (/me, /search) are declared before /:id so they are never captured as an id.
 */

/* ------------------------------ caregiver ------------------------------ */

caregiverRoutes.post(
  "/",
  authMiddleware,
  requireRole("caregiver"),
  validate(caregiverValidation.createProfile),
  audit("caregiver.profile.created", (req) => ({ userId: req.user!.id })),
  caregiverController.create,
);

caregiverRoutes.get("/me", authMiddleware, requireRole("caregiver"), caregiverController.getMine);

caregiverRoutes.patch(
  "/me",
  authMiddleware,
  requireRole("caregiver"),
  validate(caregiverValidation.updateProfile),
  caregiverController.updateMine,
);

caregiverRoutes.post(
  "/me/documents/upload-url",
  authMiddleware,
  requireRole("caregiver"),
  validate(caregiverValidation.uploadUrl),
  caregiverController.createUploadUrl,
);

caregiverRoutes.post(
  "/me/documents",
  authMiddleware,
  requireRole("caregiver"),
  validate(caregiverValidation.uploadDocument),
  audit("caregiver.document.uploaded", (req) => ({ type: req.body.type })),
  caregiverController.uploadDocument,
);

caregiverRoutes.put(
  "/me/documents/:docId",
  authMiddleware,
  requireRole("caregiver"),
  validate(caregiverValidation.replaceDocument),
  audit("caregiver.document.replaced", (req) => ({ documentId: req.params.docId })),
  caregiverController.replaceDocument,
);

caregiverRoutes.delete(
  "/me/documents/:docId",
  authMiddleware,
  requireRole("caregiver"),
  validate(caregiverValidation.deleteMyDocument),
  audit("caregiver.document.deleted", (req) => ({ documentId: req.params.docId })),
  caregiverController.deleteDocument,
);

caregiverRoutes.post(
  "/me/submit",
  authMiddleware,
  requireRole("caregiver"),
  audit("caregiver.application.submitted", (req) => ({ userId: req.user!.id })),
  caregiverController.submit,
);

caregiverRoutes.post(
  "/me/re-apply",
  authMiddleware,
  requireRole("caregiver"),
  audit("caregiver.application.reapplied", (req) => ({ userId: req.user!.id })),
  caregiverController.reApply,
);

caregiverRoutes.get(
  "/me/availability",
  authMiddleware,
  requireRole("caregiver"),
  caregiverController.getAvailability,
);

caregiverRoutes.put(
  "/me/availability",
  authMiddleware,
  requireRole("caregiver"),
  validate(caregiverValidation.setAvailability),
  caregiverController.setAvailability,
);

/* ------------------------------ coordinator ------------------------------ */

caregiverRoutes.get(
  "/",
  authMiddleware,
  requirePermission("caregivers:approve"),
  validate(caregiverValidation.list),
  caregiverController.list,
);

caregiverRoutes.get(
  "/search",
  authMiddleware,
  requirePermission("caregivers:approve"),
  validate(caregiverValidation.search),
  caregiverController.search,
);

/* ------------------------------- family ------------------------------- */

// Declared before /:id so "browse" is never captured as an id.
caregiverRoutes.get(
  "/browse",
  authMiddleware,
  requireRole("family"),
  validate(caregiverValidation.search),
  caregiverController.browse,
);

caregiverRoutes.get(
  "/:id",
  authMiddleware,
  requirePermission("caregivers:approve"),
  validate(caregiverValidation.byId),
  caregiverController.getApplication,
);

caregiverRoutes.get(
  "/:id/documents/:docId/url",
  authMiddleware,
  requirePermission("caregivers:approve"),
  validate(caregiverValidation.documentUrl),
  audit("caregiver.document.accessed", (req) => ({ caregiverId: req.params.id, documentId: req.params.docId })),
  caregiverController.getDocumentUrl,
);

caregiverRoutes.patch(
  "/:id/documents/:docId",
  authMiddleware,
  requirePermission("caregivers:approve"),
  validate(caregiverValidation.reviewDocument),
  audit("caregiver.document.reviewed", (req) => ({
    caregiverId: req.params.id,
    documentId: req.params.docId,
    status: req.body.status,
  })),
  caregiverController.reviewDocument,
);

caregiverRoutes.post(
  "/:id/review",
  authMiddleware,
  requirePermission("caregivers:approve"),
  validate(caregiverValidation.byId),
  audit("caregiver.review.started", (req) => ({ caregiverId: req.params.id })),
  caregiverController.startReview,
);

caregiverRoutes.post(
  "/:id/approve",
  authMiddleware,
  requirePermission("caregivers:approve"),
  validate(caregiverValidation.byId),
  audit("caregiver.approved", (req) => ({ caregiverId: req.params.id })),
  caregiverController.approve,
);

caregiverRoutes.post(
  "/:id/reject",
  authMiddleware,
  requirePermission("caregivers:approve"),
  validate(caregiverValidation.reject),
  audit("caregiver.rejected", (req) => ({ caregiverId: req.params.id })),
  caregiverController.reject,
);

caregiverRoutes.post(
  "/:id/request-info",
  authMiddleware,
  requirePermission("caregivers:approve"),
  validate(caregiverValidation.requestInfo),
  audit("caregiver.info.requested", (req) => ({ caregiverId: req.params.id })),
  caregiverController.requestInfo,
);

/* ---------------------------------- admin ---------------------------------- */

caregiverRoutes.post(
  "/:id/suspend",
  authMiddleware,
  requireRole("admin"),
  validate(caregiverValidation.suspend),
  audit("caregiver.suspended", (req) => ({ caregiverId: req.params.id })),
  caregiverController.suspend,
);

caregiverRoutes.post(
  "/:id/reinstate",
  authMiddleware,
  requireRole("admin"),
  validate(caregiverValidation.byId),
  audit("caregiver.reinstated", (req) => ({ caregiverId: req.params.id })),
  caregiverController.reinstate,
);