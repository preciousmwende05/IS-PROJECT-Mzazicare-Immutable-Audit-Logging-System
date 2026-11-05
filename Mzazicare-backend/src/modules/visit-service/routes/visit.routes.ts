/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

import { Router, type Request } from "express";

import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { requirePermission, requireRole } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { audit } from "@/shared/middleware/audit.middleware";

import { visitController } from "@/modules/visit-service/controllers/visit.controller";
import { visitValidation } from "@/modules/visit-service/validation/visit.validation";

export const visitRoutes = Router();

/**
 * Middleware order:
 *
 *   authMiddleware -> requireRole/requirePermission -> validate -> audit -> controller
 *
 * The guards only answer "may this role do this at all". Whether the caller is
 * the assigned caregiver or in the elder's circle is decided in the service,
 * which answers 404 for a visit the caller may not see.
 *
 * /active and /flagged are declared before /:id so they are not read as an id.
 */

const subject = (req: Request) => ({ visitId: req.params.id });

const staff = requireRole("coordinator", "admin");

// Reads

// GET / — the caller's own visits, by status and date.
visitRoutes.get("/", authMiddleware, validate(visitValidation.list), visitController.list);

// GET /active — coordinator: every visit in progress right now.
visitRoutes.get(
  "/active",
  authMiddleware,
  staff,
  validate(visitValidation.active),
  visitController.listActive,
);

// GET /flagged — coordinator: visits with verification flags.
visitRoutes.get(
  "/flagged",
  authMiddleware,
  staff,
  validate(visitValidation.flagged),
  visitController.listFlagged,
);

// GET /:id — detail; flags only in the coordinator view.
visitRoutes.get("/:id", authMiddleware, validate(visitValidation.byId), visitController.getOne);

// Caregiver actions

// POST /:id/en-route — mark travelling.
visitRoutes.post(
  "/:id/en-route",
  authMiddleware,
  requirePermission("visits:checkin"),
  validate(visitValidation.byId),
  visitController.enRoute,
);

// POST /:id/check-in — geo-verified check-in.
visitRoutes.post(
  "/:id/check-in",
  authMiddleware,
  requirePermission("visits:checkin"),
  validate(visitValidation.checkIn),
  audit("visit.checked_in", subject),
  visitController.checkIn,
);

// POST /:id/ping — location ping during the visit.
visitRoutes.post(
  "/:id/ping",
  authMiddleware,
  requirePermission("visits:checkin"),
  validate(visitValidation.ping),
  visitController.ping,
);

// POST /:id/check-out — geo-verified check-out; drives booking completion and billing.
visitRoutes.post(
  "/:id/check-out",
  authMiddleware,
  requirePermission("visits:checkin"),
  validate(visitValidation.checkOut),
  audit("visit.checked_out", subject),
  visitController.checkOut,
);

// Tracking and disputes

// GET /:id/track — live position during an active visit.
visitRoutes.get(
  "/:id/track",
  authMiddleware,
  requireRole("family", "elder", "coordinator", "admin"),
  validate(visitValidation.byId),
  visitController.track,
);

// POST /:id/dispute — the family challenges a visit.
visitRoutes.post(
  "/:id/dispute",
  authMiddleware,
  requireRole("family", "elder"),
  validate(visitValidation.dispute),
  audit("visit.disputed", subject),
  visitController.dispute,
);

// POST /:id/resolve-dispute — coordinator upholds or voids.
visitRoutes.post(
  "/:id/resolve-dispute",
  authMiddleware,
  staff,
  validate(visitValidation.resolveDispute),
  audit("visit.dispute_resolved", subject),
  visitController.resolveDispute,
);
