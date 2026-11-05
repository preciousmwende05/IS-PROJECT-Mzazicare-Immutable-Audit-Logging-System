/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The guards every booking path shares: who may act on whose behalf, and what
 * has to be true about a time window before anything is written.
 *
 * They are gathered here because three callers need the same answers — the
 * request-facing service, the recurrence generator, and the matcher — and a
 * rule like "an elder outside your care circle is a 404, not a 403" must have
 * exactly one implementation. Two copies of an access check is one copy that
 * will be wrong.
 *
 * WHAT LIVES HERE vs AT THE ROUTE
 *   The route answers "may a caregiver call this endpoint at all?" — a
 *   question about the role, answered by `requireRole`/`requirePermission`.
 *   This file answers "is THIS caregiver on THIS booking?" — a question about
 *   the data, which only a query can answer.
 */

import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from "@/shared/errors";
import type { AuthUser, Role } from "@/shared/types";
import { addMinutes } from "@/shared/utils/date.util";
import type { Booking } from "@/modules/booking-service/models/booking.model";
import { bookingRepository } from "@/modules/booking-service/repository/booking.repository";
import {
  caregiverPort,
  catalogPort,
  elderPort,
  type BookableService,
} from "@/modules/booking-service/services/booking.dependencies";

/** The verified caller. Always from the token, never from a request body. */
export type Actor = AuthUser;

/**
 * A booking (or a reschedule) needs at least this much notice.
 * WHY IT IS STRICTER THAN "in the future": a booking for eleven minutes from
 * now is not a booking, it is a disappointment. An offer round alone is given
 * 15 minutes to be answered, so anything under two hours cannot realistically
 * be matched, confirmed and travelled to.
 */
export const MIN_NOTICE_MINUTES = 120;

/** Coordinators and admins act on behalf of the platform, not of one family. */
export const isStaff = (role: Role): boolean => role === "coordinator" || role === "admin";

/** Load a booking or 404. Every path that acts on one starts here. */
export const requireBooking = async (bookingId: string): Promise<Booking> => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) throw new NotFoundError("Booking");
  return booking;
};

/**
 * assertNotice — enough warning to actually staff the visit.
 * 422, because the request is well-formed but the value is unusable.
 */
export const assertNotice = (scheduledFor: Date): void => {
  const earliest = addMinutes(new Date(), MIN_NOTICE_MINUTES);
  if (scheduledFor.getTime() < earliest.getTime()) {
    throw new UnprocessableError(`Bookings need at least ${MIN_NOTICE_MINUTES / 60} hours' notice`);
  }
};

/**
 * assertElderFree / assertCaregiverFree — the clash checks.
 * Both delegate the overlap inequality to the repository and turn a non-empty
 * result into a 409. Separate functions because the messages differ and the
 * blocking statuses differ: an elder's slot is taken when they ASK for it, a
 * caregiver's only once they COMMIT to it.
 */
export const assertElderFree = async (
  elderId: string,
  start: Date,
  end: Date,
  excludeBookingId?: string,
): Promise<void> => {
  const clashes = await bookingRepository.findClashing({ elderId }, start, end, excludeBookingId);
  if (clashes.length) {
    throw new ConflictError("This elder already has a booking that overlaps that window");
  }
};

export const assertCaregiverFree = async (
  caregiverId: string,
  start: Date,
  end: Date,
  excludeBookingId?: string,
): Promise<void> => {
  const clashes = await bookingRepository.findClashing(
    { caregiverId },
    start,
    end,
    excludeBookingId,
  );
  if (clashes.length) {
    throw new ConflictError("That caregiver already has a booking that overlaps that window");
  }
};

/** Resolve the booked service, or 404. Unpublished is indistinguishable from absent. */
export const requireBookableService = async (serviceId: string): Promise<BookableService> => {
  const service = await catalogPort.getBookable(serviceId);
  if (!service) throw new NotFoundError("Service");
  return service;
};

/**
 * assertMeetsServiceMinimum — the service's own floor, on top of the
 * platform's 15-minute one.
 * "Bathing assistance takes at least an hour" is a catalog fact, so it cannot
 * be a zod rule; it needs the service record, which means it belongs here.
 */
export const assertMeetsServiceMinimum = (
  service: BookableService,
  durationMinutes: number,
): void => {
  if (durationMinutes < service.minimumDurationMinutes) {
    throw new UnprocessableError(
      `This service requires at least ${service.minimumDurationMinutes} minutes`,
    );
  }
};

/**
 * requireCaregiverId — the caller's caregiver profile id.
 * The logged-in user id and the caregiver id are NOT the same value: one is
 * an auth-service user, the other a caregiver-service profile. Bookings store
 * the profile id, so every caregiver-facing action translates first.
 */
export const requireCaregiverId = async (actor: Actor): Promise<string> => {
  const caregiverId = await caregiverPort.getCaregiverIdForUser(actor.id);
  if (!caregiverId) throw new ForbiddenError("You do not have a caregiver profile");
  return caregiverId;
};

/**
 * assertElderAccess — may this actor act for this elder?
 * HOW IT WORKS: staff pass straight through. Everyone else must be in the
 * elder's care circle, which only elder-service can answer. A negative answer
 * is a 404 on the ELDER, deliberately: "no such elder, as far as you are
 * concerned" leaks nothing, while a 403 would confirm the record exists.
 */
export const assertElderAccess = async (elderId: string, actor: Actor): Promise<void> => {
  if (isStaff(actor.role)) return;
  if (!(await elderPort.isInCareCircle(elderId, actor.id))) {
    throw new NotFoundError("Elder");
  }
};

/**
 * assertParticipant — may this actor see or act on THIS booking?
 * HOW IT WORKS, cheapest check first:
 *   1. staff — yes.
 *   2. the user who requested it — yes, without a round trip.
 *   3. the assigned caregiver, or a caregiver who was offered it — yes. The
 *      offer case matters: a caregiver must be able to read a booking in
 *      order to decide whether to accept it.
 *   4. anyone else in the elder's care circle — yes (a second daughter can
 *      see the booking her brother made).
 *   5. otherwise 404, for the same non-disclosure reason as above.
 */
export const assertParticipant = async (booking: Booking, actor: Actor): Promise<void> => {
  if (isStaff(actor.role)) return;
  if (String(booking.requestedBy) === actor.id) return;

  if (actor.role === "caregiver") {
    const caregiverId = await requireCaregiverId(actor);
    if (booking.caregiverId && String(booking.caregiverId) === caregiverId) return;

    const offers = await bookingRepository.offerFindForBooking(String(booking._id));
    if (offers.some((offer) => String(offer.caregiverId) === caregiverId)) return;
    throw new NotFoundError("Booking");
  }

  if (await elderPort.isInCareCircle(String(booking.elderId), actor.id)) return;
  throw new NotFoundError("Booking");
};

/**
 * scopeToActor — turn "list bookings" into "list the bookings YOU may see".
 * HOW IT WORKS, by role:
 *   staff      — everything, narrowed by whatever filters they passed.
 *   caregiver  — their own bookings only. A `caregiverId` filter is IGNORED
 *                rather than honoured: accepting it would let one caregiver
 *                read another's schedule by guessing an id.
 *   family/elder — the elders they may act for, from elder-service. An
 *                explicit `elderId` must be one of those; asking for an elder
 *                outside the circle is a 404, not an empty list.
 * Returns null when the caller provably has nothing to see, which the callers
 * turn into an empty page without hitting the database at all.
 */
export const scopeToActor = async (
  actor: Actor,
  filters: { elderId?: string; caregiverId?: string },
): Promise<Record<string, unknown> | null> => {
  if (isStaff(actor.role)) {
    return {
      ...(filters.elderId ? { elderId: filters.elderId } : {}),
      ...(filters.caregiverId ? { caregiverId: filters.caregiverId } : {}),
    };
  }

  if (actor.role === "caregiver") {
    const caregiverId = await requireCaregiverId(actor);
    return {
      caregiverId,
      ...(filters.elderId ? { elderId: filters.elderId } : {}),
    };
  }

  const elderIds = await elderPort.listElderIdsForUser(actor.id);
  if (!elderIds.length) return null;

  if (filters.elderId) {
    if (!elderIds.includes(filters.elderId)) throw new NotFoundError("Elder");
    return { elderId: filters.elderId };
  }
  return { elderId: { $in: elderIds } };
};
