/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The thin layer between HTTP and the domain. Each handler does three things:
 *   1. reads what it needs from the request (body / params / req.user),
 *   2. calls ONE service method,
 *   3. shapes the reply through a view and a response util.
 *
 * There is no database access, no business rule, and no `res.status(4xx)`
 * here. When a rule fails the service THROWS an AppError and
 * error.middleware turns it into the right status — which is why a 409 for
 * "already taken" and a 404 for "not your elder" are decided in the service,
 * where the data is, and not here.
 *
 * `req.user!` is safe to assert on every route in this module: all of them
 * sit behind `authMiddleware`, so the token has already been verified. The
 * body, by contrast, is never trusted for identity — `requestedBy` comes from
 * `req.user.id`, never from `req.body`.
 *
 * Every handler is wrapped in `asyncHandler` because Express 4 does not catch
 * rejected promises; without it a thrown error would hang the request.
 */

import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { created, ok, paginated } from "@/shared/utils/response.util";
import { bookingService } from "@/modules/booking-service/services/booking.service";
import { bookingRecurrenceService } from "@/modules/booking-service/services/booking.recurrence.service";
import {
  serializeBooking,
  serializeCalendarEntry,
  serializeOffer,
  serializeRecurrenceRule,
} from "@/modules/booking-service/views/booking.view";

export const bookingController = {
  /**
   * create — POST /bookings.
   * `validate` has already coerced `scheduledFor` to a Date and stripped
   * anything the schema does not declare. 201 with the new booking, which is
   * `requested` — matching happens on a queue, so the family gets an answer
   * without waiting for caregiver-service.
   */
  create: asyncHandler(async (req: Request, res: Response) => {
    const booking = await bookingService.create(req.body, req.user!);
    return created(res, serializeBooking(booking));
  }),

  /** list — GET /bookings. Scoped to the caller inside the service. */
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await bookingService.list(req.query, req.user!);
    return paginated(res, { ...page, items: page.items.map(serializeBooking) });
  }),

  /** getOne — GET /bookings/:id. 404 for a booking the caller is not on. */
  getOne: asyncHandler(async (req: Request, res: Response) => {
    const booking = await bookingService.getForActor(req.params.id!, req.user!);
    return ok(res, serializeBooking(booking));
  }),

  /** updateNotes — PATCH /bookings/:id. Only while the booking is `requested`. */
  updateNotes: asyncHandler(async (req: Request, res: Response) => {
    const booking = await bookingService.updateNotes(req.params.id!, req.body.notes, req.user!);
    return ok(res, serializeBooking(booking));
  }),

  /** reschedule — POST /bookings/:id/reschedule. Re-runs every creation check. */
  reschedule: asyncHandler(async (req: Request, res: Response) => {
    const booking = await bookingService.reschedule(req.params.id!, req.body, req.user!);
    return ok(res, serializeBooking(booking));
  }),

  /**
   * cancel — POST /bookings/:id/cancel.
   * The response is the booking as it now stands, which is the point: a
   * family's cancel returns `cancelled` with the fee, while a caregiver's
   * returns `matching` — they released the job, they did not end it.
   */
  cancel: asyncHandler(async (req: Request, res: Response) => {
    const booking = await bookingService.cancel(req.params.id!, req.body, req.user!);
    return ok(res, serializeBooking(booking));
  }),

  /** accept — POST /bookings/:id/accept. Exactly one caller can win. */
  accept: asyncHandler(async (req: Request, res: Response) => {
    const booking = await bookingService.accept(req.params.id!, req.user!);
    return ok(res, serializeBooking(booking));
  }),

  /** decline — POST /bookings/:id/decline. May trigger a re-match. */
  decline: asyncHandler(async (req: Request, res: Response) => {
    const booking = await bookingService.decline(req.params.id!, req.user!, req.body.reason);
    return ok(res, serializeBooking(booking));
  }),

  /** assign — POST /bookings/:id/assign. A coordinator bypassing offers. */
  assign: asyncHandler(async (req: Request, res: Response) => {
    const booking = await bookingService.assign(
      req.params.id!,
      req.body.caregiverId,
      req.user!,
      req.body.reason,
    );
    return ok(res, serializeBooking(booking));
  }),

  /**
   * listOffers — GET /bookings/offers.
   * Each row carries its booking, because an offer on its own ("job #42,
   * 8 minutes left") is not something a caregiver can decide on.
   */
  listOffers: asyncHandler(async (req: Request, res: Response) => {
    const page = await bookingService.listOffers(req.user!, req.query);
    return paginated(res, {
      ...page,
      items: page.items.map(({ offer, booking }) => serializeOffer(offer, booking)),
    });
  }),

  /**
   * calendar — GET /bookings/calendar.
   * Returns the trimmed calendar view, not the full booking: a month grid
   * draws from six fields, and the range is capped in validation.
   */
  calendar: asyncHandler(async (req: Request, res: Response) => {
    const entries = await bookingService.calendar(
      req.query as unknown as { from: Date; to: Date; elderId?: string; caregiverId?: string },
      req.user!,
    );
    return ok(res, entries.map(serializeCalendarEntry), { count: entries.length });
  }),

  /**
   * createRecurring — POST /bookings/recurring.
   * 201 with the RULE, not with the bookings it produced. The occurrences are
   * ordinary bookings and are read through GET /bookings like any other; the
   * rule is the thing the family can later stop.
   */
  createRecurring: asyncHandler(async (req: Request, res: Response) => {
    const rule = await bookingRecurrenceService.createRule(req.body, req.user!);
    return created(res, serializeRecurrenceRule(rule));
  }),

  /** listRecurring — GET /bookings/recurring. */
  listRecurring: asyncHandler(async (req: Request, res: Response) => {
    const page = await bookingRecurrenceService.listRules(req.query, req.user!);
    return paginated(res, { ...page, items: page.items.map(serializeRecurrenceRule) });
  }),

  /**
   * stopRecurring — DELETE /bookings/recurring/:id.
   * 200 with the deactivated rule rather than 204, so the client can see that
   * `active` is now false and that the already-generated occurrences are
   * still there.
   */
  stopRecurring: asyncHandler(async (req: Request, res: Response) => {
    const rule = await bookingRecurrenceService.stopRule(req.params.id!, req.user!);
    return ok(res, serializeRecurrenceRule(rule));
  }),
};
