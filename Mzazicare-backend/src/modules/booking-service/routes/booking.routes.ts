/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The HTTP wiring. Reading a route left to right tells you the whole story of
 * the endpoint: does it need a token, does it need a role or permission, what
 * shape must the request be, is the outcome recorded for compliance, and what
 * runs last.
 *
 * MIDDLEWARE ORDER IS ALWAYS:
 *   authMiddleware → requireRole/requirePermission → validate → audit → controller
 *
 * ============================================================================
 * TWO THINGS TO NOTICE
 * ============================================================================
 * 1. ROUTE ORDER IS LOAD-BEARING. `/offers`, `/calendar` and `/recurring` are
 *    declared BEFORE `/:id`. Express matches in declaration order, so if
 *    `/:id` came first it would swallow all three and `GET /bookings/offers`
 *    would look up a booking whose id is the literal string "offers".
 *
 * 2. ROLES ARE CHECKED HERE; OWNERSHIP IS CHECKED IN THE SERVICE. This file
 *    can answer "may a caregiver call accept at all?" — that is a property of
 *    the role. It cannot answer "is this caregiver on this booking?", because
 *    that needs the data. Every handler therefore re-checks participation in
 *    the service layer, and no route relies on a guard here for that.
 *
 * Why `requireRole` and not `requirePermission` on cancel: cancelling is open
 * to a family, the assigned caregiver, and a coordinator — three roles, of
 * which only two hold `bookings:cancel`. A permission check would lock the
 * caregiver out of releasing a job they cannot do, which is exactly the case
 * the flow is designed around.
 */

import { Router } from "express";

import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { requirePermission, requireRole } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { audit } from "@/shared/middleware/audit.middleware";
import { bookingController } from "@/modules/booking-service/controllers/booking.controller";
import { bookingValidation } from "@/modules/booking-service/validation/booking.validation";

export const bookingRoutes = Router();

/** Who may act on a booking on the family's behalf. */
const familySide = requireRole("family", "elder", "coordinator", "admin");

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

// GET / — the caller's bookings. Any authenticated role: the SERVICE decides
// what "the caller's" means (a family's elders, a caregiver's own jobs, or
// everything for staff), so no role guard is needed or wanted here.
bookingRoutes.get("/", authMiddleware, validate(bookingValidation.list), bookingController.list);

// POST / — create a booking. `bookings:create` is held by family and admin.
// Audited with the elder and the time: who asked for care for whom, and when.
bookingRoutes.post(
  "/",
  authMiddleware,
  requirePermission("bookings:create"),
  validate(bookingValidation.create),
  audit("visit.requested", (req) => ({
    elderId: req.body.elderId,
    serviceId: req.body.serviceId,
    scheduledFor: req.body.scheduledFor,
  })),
  bookingController.create,
);

// ---------------------------------------------------------------------------
// Static paths — MUST stay above /:id (see the header)
// ---------------------------------------------------------------------------

// GET /offers — a caregiver's own open offers. Caregivers only: nobody else
// has an offer inbox, and the service resolves the caregiver from the token
// rather than from a query parameter.
bookingRoutes.get(
  "/offers",
  authMiddleware,
  requireRole("caregiver"),
  validate(bookingValidation.offers),
  bookingController.listOffers,
);

// GET /calendar — a date-range view for a calendar UI. Same scoping as GET /.
bookingRoutes.get(
  "/calendar",
  authMiddleware,
  validate(bookingValidation.calendar),
  bookingController.calendar,
);

// GET /recurring — the caller's standing arrangements.
bookingRoutes.get(
  "/recurring",
  authMiddleware,
  validate(bookingValidation.listRecurring),
  bookingController.listRecurring,
);

// POST /recurring — create a standing arrangement. Same permission as a
// one-off booking: a recurrence rule is a booking factory, so being allowed
// to make one and being allowed to make many is the same right.
bookingRoutes.post(
  "/recurring",
  authMiddleware,
  requirePermission("bookings:create"),
  validate(bookingValidation.createRecurring),
  audit("booking.recurrence_created", (req) => ({
    elderId: req.body.elderId,
    frequency: req.body.frequency,
  })),
  bookingController.createRecurring,
);

// DELETE /recurring/:id — stop FUTURE occurrences. Audited, because it ends a
// standing care arrangement; the occurrences already generated survive it.
bookingRoutes.delete(
  "/recurring/:id",
  authMiddleware,
  familySide,
  validate(bookingValidation.byId),
  audit("booking.recurrence_stopped", (req) => ({ recurrenceId: req.params.id })),
  bookingController.stopRecurring,
);

// ---------------------------------------------------------------------------
// One booking
// ---------------------------------------------------------------------------

// GET /:id — one booking. Participants only, enforced in the service, which
// answers 404 (never 403) for a booking the caller is not on.
bookingRoutes.get(
  "/:id",
  authMiddleware,
  validate(bookingValidation.byId),
  bookingController.getOne,
);

// PATCH /:id — edit the note to the caregiver, only while `requested`.
bookingRoutes.patch(
  "/:id",
  authMiddleware,
  familySide,
  validate(bookingValidation.updateNotes),
  audit("booking.notes_updated", (req) => ({ bookingId: req.params.id })),
  bookingController.updateNotes,
);

// POST /:id/reschedule — a new time, re-running every check creation ran.
// Audited with the new time: a moved visit is a change of record.
bookingRoutes.post(
  "/:id/reschedule",
  authMiddleware,
  familySide,
  validate(bookingValidation.reschedule),
  audit("booking.rescheduled", (req) => ({
    bookingId: req.params.id,
    scheduledFor: req.body.scheduledFor,
  })),
  bookingController.reschedule,
);

// POST /:id/cancel — cancel (family, coordinator) or release (caregiver).
// Audited with the reason: a cancellation carries a fee, and a fee is
// something a family may dispute months later.
bookingRoutes.post(
  "/:id/cancel",
  authMiddleware,
  requireRole("family", "elder", "caregiver", "coordinator", "admin"),
  validate(bookingValidation.cancel),
  audit("visit.cancelled", (req) => ({
    bookingId: req.params.id,
    reason: req.body.reason ?? null,
  })),
  bookingController.cancel,
);

// POST /:id/accept — the caregiver takes the job. Atomic in the service;
// exactly one of two simultaneous callers gets a 200 and the other a 409.
bookingRoutes.post(
  "/:id/accept",
  authMiddleware,
  requireRole("caregiver"),
  validate(bookingValidation.byId),
  audit("booking.accepted", (req) => ({ bookingId: req.params.id })),
  bookingController.accept,
);

// POST /:id/decline — the caregiver turns it down; may trigger a re-match.
bookingRoutes.post(
  "/:id/decline",
  authMiddleware,
  requireRole("caregiver"),
  validate(bookingValidation.decline),
  audit("booking.declined", (req) => ({ bookingId: req.params.id })),
  bookingController.decline,
);

// POST /:id/assign — a coordinator force-assigns, bypassing the offer round.
// `bookings:assign` is held by coordinator and admin only. Audited with both
// ids: an override must always be attributable to the human who made it.
bookingRoutes.post(
  "/:id/assign",
  authMiddleware,
  requirePermission("bookings:assign"),
  validate(bookingValidation.assign),
  audit("visit.assigned", (req) => ({
    bookingId: req.params.id,
    caregiverId: req.body.caregiverId,
  })),
  bookingController.assign,
);
