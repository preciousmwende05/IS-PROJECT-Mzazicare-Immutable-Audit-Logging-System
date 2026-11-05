/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * Every business rule for booking and scheduling. No express types appear
 * here: each method takes plain values and can be called from a controller, a
 * queue worker, an event handler or a seed script alike.
 *
 * The lifecycle itself lives in `booking.state.ts`, matching in
 * `booking.matching.service.ts`, and recurrence in
 * `booking.recurrence.service.ts`. This file owns everything a PERSON asks
 * for: create, read, edit, reschedule, cancel, accept, decline, assign.
 *
 * ============================================================================
 * THE FIVE RULES THAT MATTER MOST
 * ============================================================================
 * 1. SNAPSHOT AT BOOKING TIME. The price and the required skills are copied
 *    from catalog-service when the booking is made, and the elder's location
 *    from elder-service. An invoice raised in March must use March's price,
 *    not today's.
 *
 * 2. CLASH DETECTION IS `aStart < bEnd && bStart < aEnd`. Nothing else. Get
 *    an inequality wrong and you either double-book a real person or reject
 *    two visits that merely touch end to end.
 *
 * 3. ACCEPT IS ATOMIC. A conditional update, never read-then-write. Two
 *    caregivers tapping Accept in the same millisecond must produce one
 *    winner and one 409.
 *
 * 4. OWNERSHIP IS A DATA QUESTION, SO IT IS ANSWERED HERE. Roles are checked
 *    at the route ("may a caregiver call this endpoint at all?"); whether
 *    THIS caregiver is on THIS booking is checked in this file, because only
 *    the data knows. An elder outside the caller's care circle gives 404, not
 *    403 — a 403 confirms the record exists, which is itself a leak.
 *
 * 5. A COMPLETED OR CANCELLED BOOKING IS IMMUTABLE.
 */

import { publish } from "@/shared/events/bus";
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from "@/shared/errors";
import type { Paginated } from "@/shared/types";
import { addMinutes, HOUR_MS, MINUTE_MS } from "@/shared/utils/date.util";
import { buildPage, parsePagination } from "@/shared/utils/pagination.util";
import logger from "@/shared/config/logger";
import {
  type Booking,
  type BookingStatus,
  type CancelledBy,
  type NewBooking,
} from "@/modules/booking-service/models/booking.model";
import { bookingRepository } from "@/modules/booking-service/repository/booking.repository";
import {
  applyIfStatus,
  assertMutable,
  transition,
  transitionOrThrow,
} from "@/modules/booking-service/services/booking.state";
import {
  caregiverPort,
  catalogPort,
  elderPort,
  tryIsAvailableAt,
  tryRecordReliabilityEvent,
} from "@/modules/booking-service/services/booking.dependencies";
import {
  BOOKING_TEMPLATES,
  enqueueMatch,
  notify,
} from "@/modules/booking-service/services/booking.jobs";
import {
  cancellationFee,
  priceAtBooking,
} from "@/modules/booking-service/services/booking.pricing";
import {
  assertCaregiverFree,
  assertElderAccess,
  assertElderFree,
  assertMeetsServiceMinimum,
  assertNotice,
  assertParticipant,
  isStaff,
  requireBookableService,
  requireBooking,
  requireCaregiverId,
  scopeToActor,
  type Actor,
} from "@/modules/booking-service/services/booking.rules";

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------
// The numbers someone will eventually want changed are named, and each lives
// in exactly one place: the fee tiers in `booking.pricing.ts`, the notice
// window in `booking.rules.ts`, the offer deadline and fan-out in
// `booking.matching.service.ts`. A `2` buried in an `if` three files deep is
// how a policy change becomes an archaeology exercise.

/**
 * How far either side of a visit a caregiver still counts as "working with
 * this elder right now" — elder-service uses this to decide whether to hand
 * over the care plan. Early arrival and writing up notes afterwards are both
 * normal, so the window is padded rather than exact.
 */
const ACTIVE_PAIR_GRACE_MS = 30 * MINUTE_MS;

/** States a booking may be rescheduled from. An in-flight visit is not one. */
const RESCHEDULABLE: readonly BookingStatus[] = [
  "requested",
  "matching",
  "offered",
  "unassigned",
  "confirmed",
];

/** States a coordinator may force-assign from. */
const ASSIGNABLE_FROM: readonly BookingStatus[] = [
  "requested",
  "matching",
  "offered",
  "unassigned",
];

// ---------------------------------------------------------------------------
// Typed inputs — plain values, no req/res
// ---------------------------------------------------------------------------
export type { Actor };

export type CreateBookingInput = {
  elderId: string;
  serviceId: string;
  scheduledFor: Date;
  durationMinutes: number;
  notes?: string;
};

export type ListBookingFilters = {
  status?: BookingStatus;
  elderId?: string;
  caregiverId?: string;
  from?: Date;
  to?: Date;
  page?: unknown;
  limit?: unknown;
};

export type CalendarQuery = {
  from: Date;
  to: Date;
  elderId?: string;
  caregiverId?: string;
};

export type RescheduleInput = { scheduledFor: Date; durationMinutes?: number };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The window filter shared by list and calendar. */
const scheduledBetween = (from?: Date, to?: Date): Record<string, unknown> => {
  if (!from && !to) return {};
  return {
    scheduledFor: {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    },
  };
};

/**
 * The `booking.confirmed` payload. visit-service builds the visit from this
 * event alone (elder, time, length, place), so all of it must travel with it;
 * sending only the two ids meant no visit was ever created.
 */
const confirmedEvent = (booking: Booking, caregiverId: string) => {
  const [lng, lat] = (booking.location?.coordinates ?? []) as number[];
  return {
    bookingId: String(booking._id),
    caregiverId,
    elderId: String(booking.elderId),
    scheduledFor: new Date(booking.scheduledFor).toISOString(),
    durationMinutes: booking.durationMinutes,
    location: { type: "Point" as const, coordinates: [lng ?? NaN, lat ?? NaN] as [number, number] },
  };
};

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------
export const bookingService = {
  /**
   * create — POST /bookings.
   * HOW IT WORKS, in the order the checks must happen:
   *   1. Care-circle access, so an outsider learns nothing about the elder.
   *   2. Resolve the elder (we need their home location) and the service
   *      (price, pricing unit, minimum duration, required skills). Either
   *      missing is a 404 naming only which of the two.
   *   3. Duration must clear the service's minimum (422).
   *   4. The time must be far enough ahead to be staffable (422).
   *   5. The elder must be free in [start, end) (409).
   *   6. SNAPSHOT: price, required skills and location are copied onto the
   *      booking now. Nothing in this module reads them live again.
   *   7. Persist as `requested`, publish the fact, tell the family, and hand
   *      the matcher the job.
   *
   * The matcher runs on a QUEUE, not inline: the family's POST must not wait
   * on caregiver-service, and a matcher failure must be retried without
   * losing the booking the family already made.
   */
  create: async (input: CreateBookingInput, actor: Actor): Promise<Booking> => {
    await assertElderAccess(input.elderId, actor);

    const elder = await elderPort.getById(input.elderId);
    if (!elder) throw new NotFoundError("Elder");

    const service = await requireBookableService(input.serviceId);
    assertMeetsServiceMinimum(service, input.durationMinutes);
    assertNotice(input.scheduledFor);

    const endsAt = addMinutes(input.scheduledFor, input.durationMinutes);
    await assertElderFree(input.elderId, input.scheduledFor, endsAt);

    const booking = await bookingRepository.create({
      elderId: input.elderId as unknown as Booking["elderId"],
      serviceId: input.serviceId as unknown as Booking["serviceId"],
      requestedBy: actor.id as unknown as Booking["requestedBy"],
      scheduledFor: input.scheduledFor,
      durationMinutes: input.durationMinutes,
      endsAt,
      location: elder.homeLocation as unknown as Booking["location"],
      priceCentsAtBooking: priceAtBooking(
        service.pricingUnit,
        service.basePriceCents,
        input.durationMinutes,
      ),
      requiredSkillsAtBooking: service.requiredSkills,
      notes: input.notes ?? null,
      status: "requested",
    });

    await publish("booking.requested", {
      bookingId: String(booking._id),
      elderId: String(booking.elderId),
      serviceId: String(booking.serviceId),
      scheduledFor: booking.scheduledFor.toISOString(),
    });

    await notify({
      template: BOOKING_TEMPLATES.requested,
      audience: { userIds: [actor.id] },
      data: { bookingId: String(booking._id), scheduledFor: booking.scheduledFor.toISOString() },
    });

    await enqueueMatch(String(booking._id), { reason: "created" });

    return booking;
  },

  /**
   * getById — the trusted, unchecked read.
   * FOR OTHER MODULES (billing-service asks for a booking to invoice it).
   * There is no actor here because there is no HTTP caller: a module asking
   * on its own behalf has already been trusted. Controllers must use
   * `getForActor` instead, and the two are separate methods precisely so that
   * "skip the access check" can never happen by forgetting an argument.
   */
  getById: async (bookingId: string): Promise<Booking | null> =>
    bookingRepository.findById(bookingId),

  /** GET /bookings/:id — the access-checked read. */
  getForActor: async (bookingId: string, actor: Actor): Promise<Booking> => {
    const booking = await requireBooking(bookingId);
    await assertParticipant(booking, actor);
    return booking;
  },

  /** GET /bookings — the caller's bookings, newest visit first. */
  list: async (filters: ListBookingFilters, actor: Actor): Promise<Paginated<Booking>> => {
    const { page, limit, skip } = parsePagination(filters);

    const scope = await scopeToActor(actor, filters);
    if (!scope) return buildPage<Booking>([], 0, page, limit);

    const where = {
      ...scope,
      ...(filters.status ? { status: filters.status } : {}),
      ...scheduledBetween(filters.from, filters.to),
    };

    const [items, total] = await bookingRepository.findPage(where, skip, limit);
    return buildPage(items, total, page, limit);
  },

  /**
   * calendar — GET /bookings/calendar.
   * Same scoping as `list`, but overlap-based rather than start-based: a
   * visit that began before the window and is still running must appear on
   * the grid. Unpaginated by design — a calendar draws a whole range at once
   * — which is why the range itself is capped in validation.
   */
  calendar: async (query: CalendarQuery, actor: Actor): Promise<Booking[]> => {
    const scope = await scopeToActor(actor, query);
    if (!scope) return [];
    return bookingRepository.findInRange(scope, query.from, query.to);
  },

  /**
   * updateNotes — PATCH /bookings/:id.
   * Only while `requested`, and that is not arbitrary: once offers are out,
   * caregivers have decided whether to accept based on what the note said.
   * Changing it underneath them would mean someone accepted a different job
   * from the one they are now doing.
   */
  updateNotes: async (bookingId: string, notes: string | null, actor: Actor): Promise<Booking> => {
    const booking = await requireBooking(bookingId);
    await assertParticipant(booking, actor);
    assertMutable(booking);

    const updated = await applyIfStatus(bookingId, ["requested"], { notes });
    if (!updated) {
      throw new ConflictError("Notes can only be edited while a booking is still requested");
    }
    return updated;
  },

  /**
   * reschedule — POST /bookings/:id/reschedule.
   * HOW IT WORKS: rescheduling re-runs EVERY check that creating ran, because
   * a new time is a new booking in all but identity.
   *   1. Participant, and not a finished or in-flight booking.
   *   2. The service minimum, if the duration changed and the catalog can
   *      still answer. An archived service keeps its existing bookings
   *      working (catalog-service's own rule), so an unresolvable service is
   *      not a reason to refuse the move.
   *   3. Minimum notice for the NEW time.
   *   4. The elder must be free then — excluding this booking, which would
   *      otherwise clash with itself.
   *   5. If a caregiver is already assigned, they must be free then too, and
   *      still available at that hour. If either fails they are RELEASED and
   *      the booking re-enters matching: better to re-staff it than to record
   *      a commitment nobody can keep.
   *   6. The price is NOT recomputed. The family agreed a price; moving the
   *      appointment is not a repricing event.
   */
  reschedule: async (bookingId: string, input: RescheduleInput, actor: Actor): Promise<Booking> => {
    const booking = await requireBooking(bookingId);
    await assertParticipant(booking, actor);
    assertMutable(booking);
    if (!RESCHEDULABLE.includes(booking.status)) {
      throw new ConflictError(`A ${booking.status} booking cannot be rescheduled`);
    }

    const durationMinutes = input.durationMinutes ?? booking.durationMinutes;
    if (durationMinutes !== booking.durationMinutes) {
      const service = await catalogPort.getBookable(String(booking.serviceId));
      if (service) assertMeetsServiceMinimum(service, durationMinutes);
    }

    assertNotice(input.scheduledFor);
    const endsAt = addMinutes(input.scheduledFor, durationMinutes);
    await assertElderFree(String(booking.elderId), input.scheduledFor, endsAt, bookingId);

    const patch: Partial<NewBooking> = {
      scheduledFor: input.scheduledFor,
      durationMinutes,
      endsAt,
    };

    // Can the assigned caregiver still do it? Two questions: are they free
    // (clash), and do they work then (availability). "Don't know" from
    // caregiver-service is not treated as a no.
    let releasedCaregiverId: string | null = null;
    if (booking.caregiverId) {
      const caregiverId = String(booking.caregiverId);
      const clashes = await bookingRepository.findClashing(
        { caregiverId },
        input.scheduledFor,
        endsAt,
        bookingId,
      );
      const available = await tryIsAvailableAt(caregiverId, input.scheduledFor, durationMinutes);
      if (clashes.length || available === false) {
        releasedCaregiverId = caregiverId;
        patch.caregiverId = null;
        patch.confirmedAt = null;
      }
    }

    const target: BookingStatus = releasedCaregiverId ? "matching" : booking.status;
    const updated =
      target === booking.status
        ? await applyIfStatus(bookingId, RESCHEDULABLE, patch)
        : await transition(bookingId, target, { from: ["confirmed"], patch });

    if (!updated) throw new ConflictError("The booking changed while it was being rescheduled");

    await publish("booking.rescheduled", {
      bookingId,
      scheduledFor: updated.scheduledFor.toISOString(),
    });

    if (releasedCaregiverId) {
      await bookingRepository.offerExpireAll(bookingId);
      await enqueueMatch(bookingId, { reason: "rescheduled out of the caregiver's window" });
      await notify({
        template: BOOKING_TEMPLATES.reassigning,
        audience: { userIds: [String(updated.requestedBy)] },
        data: { bookingId, scheduledFor: updated.scheduledFor.toISOString() },
        urgency: "high",
      });
      return updated;
    }

    await notify({
      template: BOOKING_TEMPLATES.rescheduled,
      audience: {
        userIds: [String(updated.requestedBy)],
        ...(updated.caregiverId ? { caregiverIds: [String(updated.caregiverId)] } : {}),
      },
      data: { bookingId, scheduledFor: updated.scheduledFor.toISOString() },
    });

    // Offers were out for the OLD time. A caregiver deciding on "Tuesday 9am"
    // must not end up committed to Thursday 2pm because the family moved the
    // booking while they were thinking about it. So the offers are withdrawn
    // and the booking re-enters matching: the same three caregivers may well
    // be offered it again, but for the time that is now actually being asked
    // for.
    if (booking.status === "offered") {
      await bookingRepository.offerExpireAll(bookingId);
      const back = await transition(bookingId, "matching", { from: ["offered"] });
      if (back) {
        await enqueueMatch(bookingId, { reason: "rescheduled while offers were out" });
        return back;
      }
    }

    return updated;
  },

  /**
   * cancel — POST /bookings/:id/cancel.
   * HOW IT WORKS: WHO cancels decides what happens, and the two outcomes are
   * genuinely different.
   *
   *   A CAREGIVER cancelling does not cancel the booking. The family still
   *   wants the visit, so the caregiver is released and the booking re-enters
   *   matching, urgently. No fee, and the release is recorded against the
   *   caregiver's reliability. No `booking.cancelled` event is published —
   *   nothing was cancelled; the next `booking.confirmed` carries the new
   *   caregiver.
   *
   *   A FAMILY or a COORDINATOR cancelling ends the booking, with the fee from
   *   the tier table, and publishes `booking.cancelled` carrying that fee so
   *   billing-service can invoice or void without recomputing policy.
   */
  cancel: async (bookingId: string, input: { reason?: string }, actor: Actor): Promise<Booking> => {
    const booking = await requireBooking(bookingId);
    await assertParticipant(booking, actor);
    assertMutable(booking);

    const cancelledBy: CancelledBy = isStaff(actor.role)
      ? "coordinator"
      : actor.role === "caregiver"
        ? "caregiver"
        : "family";

    if (cancelledBy === "caregiver") {
      const caregiverId = await requireCaregiverId(actor);
      if (!booking.caregiverId || String(booking.caregiverId) !== caregiverId) {
        throw new ForbiddenError("You are not assigned to this booking");
      }

      const released = await transitionOrThrow(bookingId, "matching", {
        from: ["confirmed"],
        patch: { caregiverId: null, confirmedAt: null },
      });

      await bookingRepository.offerExpireAll(bookingId);
      await tryRecordReliabilityEvent(caregiverId, "late_release", {
        bookingId,
        hoursNotice: (booking.scheduledFor.getTime() - Date.now()) / HOUR_MS,
      });
      await enqueueMatch(bookingId, { reason: "caregiver released the booking" });
      await notify({
        template: BOOKING_TEMPLATES.reassigning,
        audience: { userIds: [String(booking.requestedBy)] },
        data: { bookingId, scheduledFor: booking.scheduledFor.toISOString() },
        urgency: "high",
      });

      return released;
    }

    const feeCents = cancellationFee(
      cancelledBy,
      booking.priceCentsAtBooking,
      booking.scheduledFor,
      new Date(),
    );

    const cancelled = await transitionOrThrow(bookingId, "cancelled", {
      patch: {
        cancelledBy,
        cancelledByUserId: actor.id as unknown as Booking["cancelledByUserId"],
        cancellationReason: input.reason ?? null,
        cancellationFeeCents: feeCents,
        cancelledAt: new Date(),
      },
    });

    await bookingRepository.offerExpireAll(bookingId);

    await publish("booking.cancelled", {
      bookingId,
      cancelledBy,
      cancellationFeeCents: feeCents,
      ...(input.reason ? { reason: input.reason } : {}),
    });

    await notify({
      template: BOOKING_TEMPLATES.cancelled,
      audience: {
        userIds: [String(booking.requestedBy)],
        ...(booking.caregiverId ? { caregiverIds: [String(booking.caregiverId)] } : {}),
      },
      data: { bookingId, cancelledBy, feeCents },
    });

    return cancelled;
  },

  /**
   * accept — POST /bookings/:id/accept. THE RACE.
   * HOW IT WORKS:
   *   1. Translate the user to their caregiver profile id.
   *   2. They must hold an OPEN, unexpired offer. No offer is a 409, not a
   *      403: the offer existed, it simply is not theirs to take any more.
   *   3. Re-check their own calendar. Fifteen minutes passed since the offer
   *      went out, and they may have accepted something else in between.
   *   4. `confirmIfOffered` — one conditional update, with `status:
   *      "offered"` in the FILTER. This is the whole race resolution: Mongo
   *      picks the winner. A null return means somebody else already did, and
   *      becomes "Already taken".
   *   5. Only then record their offer as accepted and expire the losers.
   *      Order matters: if the process died between 4 and 5 the booking is
   *      still correctly confirmed, and the offer rows are cosmetic. Doing it
   *      the other way round could leave an accepted offer against an
   *      unconfirmed booking — a lie.
   */
  accept: async (bookingId: string, actor: Actor): Promise<Booking> => {
    const caregiverId = await requireCaregiverId(actor);
    const booking = await requireBooking(bookingId);

    const offer = await bookingRepository.offerFindOpen(bookingId, caregiverId);
    if (!offer) throw new ConflictError("This offer is no longer open");

    await assertCaregiverFree(caregiverId, booking.scheduledFor, booking.endsAt, bookingId);

    const confirmed = await bookingRepository.confirmIfOffered(bookingId, caregiverId);
    if (!confirmed) throw new ConflictError("This booking has already been taken");

    await bookingRepository.offerRespond(String(offer._id), "accepted");
    await bookingRepository.offerExpireOthers(bookingId, caregiverId);

    await publish("booking.confirmed", confirmedEvent(confirmed, caregiverId));

    await notify({
      template: BOOKING_TEMPLATES.confirmedFamily,
      audience: { userIds: [String(confirmed.requestedBy)] },
      data: {
        bookingId,
        caregiverId,
        scheduledFor: confirmed.scheduledFor.toISOString(),
      },
    });
    await notify({
      template: BOOKING_TEMPLATES.confirmedCaregiver,
      audience: { caregiverIds: [caregiverId] },
      data: {
        bookingId,
        elderId: String(confirmed.elderId),
        scheduledFor: confirmed.scheduledFor.toISOString(),
      },
    });

    return confirmed;
  },

  /**
   * decline — POST /bookings/:id/decline.
   * HOW IT WORKS: mark this caregiver's offer declined, then ask whether
   * anyone is still considering the booking. If nobody is, it goes back to
   * matching and the matcher runs again — which is the difference between a
   * declined booking being re-staffed and one quietly dying in `offered`.
   *
   * `offerRespond` returning null means the offer was already answered (a
   * double tap, or a retried job), and the re-match check is skipped: that is
   * what makes this safe to call twice.
   */
  decline: async (bookingId: string, actor: Actor, reason?: string): Promise<Booking> => {
    const caregiverId = await requireCaregiverId(actor);
    const booking = await requireBooking(bookingId);

    const offer = await bookingRepository.offerFindOpen(bookingId, caregiverId);
    if (!offer) throw new ConflictError("This offer is no longer open");

    const responded = await bookingRepository.offerRespond(String(offer._id), "declined", {
      declineReason: reason ?? null,
    });
    if (!responded) return booking;

    await tryRecordReliabilityEvent(caregiverId, "declined_offer", { bookingId });

    if ((await bookingRepository.offerCountOpen(bookingId)) === 0) {
      const back = await transition(bookingId, "matching", { from: ["offered"] });
      if (back) await enqueueMatch(bookingId, { reason: "all offers declined" });
    }

    return (await bookingRepository.findById(bookingId)) ?? booking;
  },

  /**
   * assign — POST /bookings/:id/assign. The coordinator's override.
   * HOW IT WORKS: skips offers entirely and confirms the named caregiver. It
   * still checks the two things that protect a real person: caregiver-service
   * must say they are assignable (approved — never inferred from our own
   * data), and their calendar must be free. Force-assign means "bypass the
   * offer round", not "bypass safety".
   */
  assign: async (
    bookingId: string,
    caregiverId: string,
    actor: Actor,
    reason?: string,
  ): Promise<Booking> => {
    const booking = await requireBooking(bookingId);
    assertMutable(booking);
    if (!ASSIGNABLE_FROM.includes(booking.status)) {
      throw new ConflictError(`A ${booking.status} booking cannot be assigned`);
    }

    if (!(await caregiverPort.isAssignable(caregiverId))) {
      throw new UnprocessableError("That caregiver is not currently assignable");
    }
    await assertCaregiverFree(caregiverId, booking.scheduledFor, booking.endsAt, bookingId);

    const confirmed = await transitionOrThrow(bookingId, "confirmed", {
      from: ASSIGNABLE_FROM,
      patch: { caregiverId: caregiverId as unknown as Booking["caregiverId"] },
    });

    await bookingRepository.offerExpireAll(bookingId);
    await publish("booking.confirmed", confirmedEvent(confirmed, caregiverId));

    await notify({
      template: BOOKING_TEMPLATES.assigned,
      audience: {
        userIds: [String(confirmed.requestedBy)],
        caregiverIds: [caregiverId],
      },
      data: {
        bookingId,
        assignedBy: actor.id,
        reason: reason ?? null,
        scheduledFor: confirmed.scheduledFor.toISOString(),
      },
    });

    return confirmed;
  },

  /**
   * listOffers — GET /bookings/offers. A caregiver's inbox.
   * The bookings are hydrated in ONE query rather than one per offer: an
   * offer without its booking tells the caregiver nothing they can decide on,
   * and a loop of findById here would be three queries per screen for no
   * reason.
   */
  listOffers: async (
    actor: Actor,
    query: { scope?: "open" | "all"; page?: unknown; limit?: unknown },
  ) => {
    const caregiverId = await requireCaregiverId(actor);
    const { page, limit, skip } = parsePagination(query);

    const [offers, total] = await bookingRepository.offerFindPageForCaregiver(
      caregiverId,
      (query.scope ?? "open") === "open",
      skip,
      limit,
    );

    const bookings = await bookingRepository.findByIds(
      offers.map((offer) => String(offer.bookingId)),
    );
    const byId = new Map(bookings.map((booking) => [String(booking._id), booking]));

    return buildPage(
      offers.map((offer) => ({ offer, booking: byId.get(String(offer.bookingId)) })),
      total,
      page,
      limit,
    );
  },

  // =========================================================================
  // Lifecycle driven from outside — visit-service and caregiver-service
  // =========================================================================
  // Every method below is IDEMPOTENT. They are called from event handlers,
  // and a failed job is retried, so the same event will arrive twice. Each
  // one is a conditional transition whose second run finds nothing to do and
  // says so quietly instead of re-firing side effects.

  /**
   * attachVisit — `visit.scheduled`: stamp the visitId as soon as the visit
   * exists, so the caregiver can find it and check in. Idempotent: a repeat
   * delivery writes the same value.
   */
  attachVisit: async (bookingId: string, visitId: string): Promise<Booking | null> =>
    bookingRepository.update(bookingId, { visitId: visitId as unknown as Booking["visitId"] }),

  /**
   * markCheckedIn — `visit.checked_in`: confirmed → in_progress.
   * Also stamps the visitId, which is how `visit.checked_out` (which carries
   * only a visitId) is later mapped back to this booking.
   */
  markCheckedIn: async (bookingId: string, visitId: string): Promise<Booking | null> => {
    const updated = await transition(bookingId, "in_progress", {
      from: ["confirmed"],
      patch: { visitId: visitId as unknown as Booking["visitId"] },
    });
    if (!updated) {
      logger.debug(`[booking] check-in for ${bookingId} ignored — not a confirmed booking`);
    }
    return updated;
  },

  /**
   * markCheckedOut — `visit.checked_out`: in_progress → completed.
   * The event carries no bookingId, so we look the booking up by the visitId
   * stamped at check-in. A miss is logged rather than thrown: a check-out for
   * a visit we never saw checked in is visit-service's story to tell, and
   * throwing here would only retry the job forever.
   */
  markCheckedOut: async (visitId: string): Promise<Booking | null> => {
    const booking = await bookingRepository.findByVisitId(visitId);
    if (!booking) {
      logger.warn(`[booking] check-out for visit ${visitId} matched no booking`);
      return null;
    }
    return transition(String(booking._id), "completed", { from: ["in_progress"] });
  },

  /**
   * markMissed — `visit.missed`: confirmed → no_show.
   * Terminal. The family is told, because a caregiver who never arrived is
   * the single worst experience this platform can deliver, and silence makes
   * it worse.
   */
  markMissed: async (bookingId: string): Promise<Booking | null> => {
    const updated = await transition(bookingId, "no_show", { from: ["confirmed"] });
    if (!updated) return null;

    if (updated.caregiverId) {
      await tryRecordReliabilityEvent(String(updated.caregiverId), "no_show", { bookingId });
    }
    await notify({
      template: BOOKING_TEMPLATES.cancelled,
      audience: { userIds: [String(updated.requestedBy)] },
      data: { bookingId, reason: "The caregiver did not arrive" },
      urgency: "high",
    });
    return updated;
  },

  /**
   * releaseUpcomingFor — `caregiver.suspended`.
   * HOW IT WORKS: every future booking this caregiver had committed to is
   * released and put back into matching, one conditional transition at a
   * time. The `from: ["confirmed"]` guard does two jobs: it leaves an
   * in-flight visit alone (a caregiver already in someone's home is not
   * yanked out by an administrative event), and it makes the whole loop
   * idempotent — a retried event re-reads the same bookings, fails every CAS,
   * and therefore does not notify a single family twice.
   *
   * That guard is the reason the notification sits INSIDE the `if`.
   */
  releaseUpcomingFor: async (caregiverId: string, reason?: string): Promise<number> => {
    const upcoming = await bookingRepository.findCommittedFromFor(caregiverId, new Date());
    let released = 0;

    for (const booking of upcoming) {
      const bookingId = String(booking._id);
      const updated = await transition(bookingId, "matching", {
        from: ["confirmed"],
        patch: { caregiverId: null, confirmedAt: null },
      });
      if (!updated) continue;

      released += 1;
      await bookingRepository.offerExpireAll(bookingId);
      await enqueueMatch(bookingId, { reason: reason ?? "caregiver released" });
      await notify({
        template: BOOKING_TEMPLATES.reassigning,
        audience: { userIds: [String(booking.requestedBy)] },
        data: { bookingId, scheduledFor: booking.scheduledFor.toISOString() },
        urgency: "high",
      });
    }

    if (released) {
      logger.info(`[booking] released ${released} booking(s) from caregiver ${caregiverId}`);
    }
    return released;
  },

  // =========================================================================
  // Questions other modules ask us
  // =========================================================================

  /**
   * hasActiveBookingFor — elder-service's access check for caregivers.
   * "Is this caregiver working with this elder right now?" decides whether a
   * caregiver may read an elder's care plan. We answer it; elder-service must
   * never read our collection to work it out for itself.
   */
  hasActiveBookingFor: async (
    caregiverId: string,
    elderId: string,
    at: Date = new Date(),
  ): Promise<boolean> =>
    bookingRepository.existsActiveForPair(caregiverId, elderId, at, ACTIVE_PAIR_GRACE_MS),

  /** operations-service's dashboard tile: bookings nobody could be found for. */
  countUnassigned: async (): Promise<number> => bookingRepository.countByStatus("unassigned"),
};
