/**
 * U-CS 68 — Digital Elder Profile & Care Data System
 * Owner(s): Ian Omwenga, Mepani Bhavin Ramesh
 */

import { Router } from "express";

import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { requireRole } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { audit } from "@/shared/middleware/audit.middleware";

import { elderController } from "@/modules/elder-service/controllers/elder.controller";
import { elderValidation } from "@/modules/elder-service/validation/elder.validation";

export const elderRoutes = Router();

/**
 * Middleware order:
 *
 *   authMiddleware
 *   -> requireRole / permission where applicable
 *   -> validate
 *   -> audit
 *   -> controller
 *
 * Circle membership and ownership remain service-layer decisions.
 *
 * The service deliberately returns 404 when a caller is outside an elder's
 * circle so the existence of the elder is not disclosed.
 */

// =============================================================================
// Elder profile
// =============================================================================

// GET /
// Elders belonging to the caller's accepted care circles.
elderRoutes.get(
  "/",
  authMiddleware,
  validate(elderValidation.list),
  elderController.list,
);

// POST /
// Family member creates an elder and becomes owner.
elderRoutes.post(
  "/",
  authMiddleware,
  requireRole("family"),
  validate(elderValidation.create),
  audit("elder.created", (req) => ({
    elderId: req.res?.locals.elderId,
  })),
  elderController.create,
);

// GET /:id
// Full elder profile. Every view is audited: "who viewed this person's
// records" and snooping detection are built on it.
elderRoutes.get(
  "/:id",
  authMiddleware,
  validate(elderValidation.byId),
  audit("elder.viewed", (req) => ({ elderId: req.params.id })),
  elderController.getOne,
);

// PATCH /:id
// Demographics, address and status.
elderRoutes.patch(
  "/:id",
  authMiddleware,
  requireRole("family"),
  validate(elderValidation.update),
  audit("elder.updated", (req) => ({
    elderId: req.params.id,
    fields: Object.keys(req.body),
  })),
  elderController.update,
);

// Caregiver brief

// GET /:id/brief
//
// Caregiver access is additionally restricted in elderService through:
//
// bookingService.hasActiveBookingFor(caregiverId, elderId)
//
// Therefore a caregiver cannot retrieve the brief merely by knowing elderId.
elderRoutes.get(
  "/:id/brief",
  authMiddleware,
  requireRole("caregiver"),
  validate(elderValidation.byId),
  audit("elder.brief.viewed", (req) => ({
    elderId: req.params.id,
  })),
  elderController.brief,
);

// Care plans

// GET /:id/care-plan
//
// Accessible to:
// - accepted circle members
// - authorised staff
// - caregiver with an active booking
//
// The service performs the actual authorization.
elderRoutes.get(
  "/:id/care-plan",
  authMiddleware,
  validate(elderValidation.byId),
  audit("careplan.viewed", (req) => ({
    elderId: req.params.id,
  })),
  elderController.getCarePlan,
);

// PATCH /:id/care-plan
//
// Creates a NEW care-plan version.
// Existing versions are never overwritten.
elderRoutes.patch(
  "/:id/care-plan",
  authMiddleware,
  validate(elderValidation.updateCarePlan),
  audit("careplan.updated", (req) => ({
    elderId: req.params.id,
    fields: Object.keys(req.body),
  })),
  elderController.updateCarePlan,
);

// GET /:id/care-plan/history
//
// Editor+ access is enforced by the service.
elderRoutes.get(
  "/:id/care-plan/history",
  authMiddleware,
  validate(elderValidation.carePlanHistory),
  audit("careplan.history.viewed", (req) => ({ elderId: req.params.id })),
  elderController.getCarePlanHistory,
);

// Emergency contacts

// GET /:id/emergency-contacts
elderRoutes.get(
  "/:id/emergency-contacts",
  authMiddleware,
  validate(elderValidation.listEmergencyContacts),
  audit("emergencycontacts.viewed", (req) => ({ elderId: req.params.id })),
  elderController.listEmergencyContacts,
);

// POST /:id/emergency-contacts
//
// Circle editor/owner access is enforced by the service.
elderRoutes.post(
  "/:id/emergency-contacts",
  authMiddleware,
  validate(elderValidation.addEmergencyContact),
  audit("emergencycontact.added", (req) => ({
    elderId: req.params.id,
  })),
  elderController.addEmergencyContact,
);

// =============================================================================
// Care circle
// =============================================================================

// GET /:id/care-circle
//
// Accepted and pending members are returned so owners can see outstanding
// invitations.
elderRoutes.get(
  "/:id/care-circle",
  authMiddleware,
  validate(elderValidation.listCareCircle),
  audit("carecircle.viewed", (req) => ({ elderId: req.params.id })),
  elderController.listCareCircle,
);

// POST /:id/care-circle
//
// Only owner can invite.
elderRoutes.post(
  "/:id/care-circle",
  authMiddleware,
  validate(elderValidation.inviteCareCircleMember),
  audit("carecircle.member.invited", (req) => ({
    elderId: req.params.id,
    userId: req.body.userId,
  })),
  elderController.inviteCareCircleMember,
);

// POST /:id/care-circle/accept
//
// The invited user accepts their own pending invitation. Registered before
// the "/:userId" routes so "accept" is never read as a user id.
elderRoutes.post(
  "/:id/care-circle/accept",
  authMiddleware,
  validate(elderValidation.listCareCircle),
  audit("carecircle.member.added", (req) => ({
    elderId: req.params.id,
    userId: req.user!.id,
  })),
  elderController.acceptCareCircleInvitation,
);

// PATCH /:id/care-circle/:userId
//
// Only owner can change editor/viewer access.
elderRoutes.patch(
  "/:id/care-circle/:userId",
  authMiddleware,
  validate(elderValidation.updateCareCircleMember),
  audit("carecircle.member.updated", (req) => ({
    elderId: req.params.id,
    userId: req.params.userId,
  })),
  elderController.updateCareCircleMember,
);

// DELETE /:id/care-circle/:userId
//
// Service prevents removal of the final owner.
elderRoutes.delete(
  "/:id/care-circle/:userId",
  authMiddleware,
  validate(elderValidation.removeCareCircleMember),
  audit("carecircle.member.removed", (req) => ({
    elderId: req.params.id,
    userId: req.params.userId,
  })),
  elderController.removeCareCircleMember,
);