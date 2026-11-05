/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The ONLY layer allowed to touch the database. Repositories answer data
 * questions ("find these rows", "write this row") and nothing else — no
 * thrown business errors, no policy, no events.
 *
 * All three collections this module owns are served from ONE repository
 * object, with the offer and recurrence methods prefixed (`offer…`,
 * `recurrence…`) so their subject is obvious at the call site.
 *
 * ============================================================================
 * THE TWO METHODS TO READ FIRST
 * ============================================================================
 *
 * `findClashing` — clash detection. Two half-open ranges [aStart, aEnd) and
 * [bStart, bEnd) overlap when `aStart < bEnd && bStart < aEnd`. In Mongo that
 * is `scheduledFor < end AND endsAt > start`, which is why `endsAt` is a
 * stored, indexed column. Getting either inequality wrong (>= instead of >)
 * either double-books a real person or refuses two visits that merely touch.
 *
 * `confirmIfOffered` — the atomic compare-and-swap behind Accept. The status
 * guard lives in the FILTER, not in a JavaScript `if`, so two caregivers
 * tapping Accept in the same millisecond cannot both win: Mongo applies one
 * update, the other filter no longer matches and returns null.
 */

import type { FilterQuery, Types } from "mongoose";

import {
  AssignmentOfferModel,
  BookingModel,
  RecurrenceRuleModel,
  CAREGIVER_BLOCKING_STATUSES,
  ELDER_BLOCKING_STATUSES,
  type AssignmentOffer,
  type Booking,
  type BookingStatus,
  type NewAssignmentOfferInput,
  type NewBooking,
  type NewBookingInput,
  type NewRecurrenceRule,
  type NewRecurrenceRuleInput,
  type OfferStatus,
  type RecurrenceRule,
} from "@/modules/booking-service/models/booking.model";

/** Either side of a clash check: an elder's calendar or a caregiver's. */
export type ClashSubject = { elderId: string } | { caregiverId: string };

export const bookingRepository = {
  // =========================================================================
  // Bookings
  // =========================================================================

  findById: async (id: string): Promise<Booking | null> =>
    BookingModel.findById(id).lean<Booking>(),

  /**
   * findByVisitId — map a visit back to its booking.
   * WHY IT EXISTS: `visit.checked_out` carries only a visitId. We stamped the
   * visitId onto the booking when `visit.checked_in` arrived (that event has
   * both ids), so this lookup closes the loop without visit-service having to
   * change its event payload.
   */
  findByVisitId: async (visitId: string): Promise<Booking | null> =>
    BookingModel.findOne({ visitId }).lean<Booking>(),

  /**
   * findByIds — hydrate many bookings in one round trip.
   * Used by the offers inbox, which would otherwise be a findById per offer.
   */
  findByIds: async (ids: string[]): Promise<Booking[]> => {
    if (!ids.length) return [];
    return BookingModel.find({ _id: { $in: ids } }).lean<Booking[]>();
  },

  create: async (data: NewBookingInput): Promise<Booking> => {
    const doc = await BookingModel.create(data);
    return doc.toObject() as Booking;
  },

  update: async (id: string, patch: Partial<NewBooking>): Promise<Booking | null> =>
    BookingModel.findByIdAndUpdate(id, patch, { new: true }).lean<Booking>(),

  delete: async (id: string): Promise<void> => {
    await BookingModel.findByIdAndDelete(id);
  },

  /**
   * findPage — one page of bookings plus the total, for the list endpoints.
   * HOW IT WORKS: the two queries run concurrently with Promise.all — the
   * count does not depend on the page, so serialising them would just add a
   * round trip. Sorted by `scheduledFor` ascending: a care list is read
   * "what is coming up", not "what was entered last".
   */
  findPage: async (
    where: FilterQuery<Booking>,
    skip: number,
    limit: number,
  ): Promise<[Booking[], number]> =>
    Promise.all([
      BookingModel.find(where).sort({ scheduledFor: 1 }).skip(skip).limit(limit).lean<Booking[]>(),
      BookingModel.countDocuments(where),
    ]),

  /**
   * findInRange — every booking overlapping a date range, for the calendar.
   * HOW IT WORKS: same overlap inequality as findClashing. A visit that
   * started before `from` and is still running at `from` must appear on the
   * grid, which a naive `scheduledFor: { $gte: from }` would drop.
   */
  findInRange: async (
    where: FilterQuery<Booking>,
    from: Date,
    to: Date,
    limit = 1000,
  ): Promise<Booking[]> =>
    BookingModel.find({ ...where, scheduledFor: { $lt: to }, endsAt: { $gt: from } })
      .sort({ scheduledFor: 1 })
      .limit(limit)
      .lean<Booking[]>(),

  /**
   * findClashing — bookings that overlap [start, end) for one elder or one
   * caregiver.
   * HOW IT WORKS:
   *   1. The subject decides both the filter field AND which statuses count
   *      as blocking. An elder's slot is taken the moment they ask for it
   *      (`requested` onwards); a caregiver's is taken only once they have
   *      committed (`confirmed`), because an open offer is not a promise.
   *   2. The overlap predicate is the pair of strict inequalities described
   *      in the file header.
   *   3. `excludeBookingId` exists for rescheduling: a booking must not be
   *      found to clash with its own current slot.
   */
  findClashing: async (
    subject: ClashSubject,
    start: Date,
    end: Date,
    excludeBookingId?: string,
  ): Promise<Booking[]> => {
    const isElder = "elderId" in subject;
    const where: FilterQuery<Booking> = {
      ...(isElder ? { elderId: subject.elderId } : { caregiverId: subject.caregiverId }),
      status: { $in: isElder ? ELDER_BLOCKING_STATUSES : CAREGIVER_BLOCKING_STATUSES },
      scheduledFor: { $lt: end },
      endsAt: { $gt: start },
      ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
    };
    return BookingModel.find(where).lean<Booking[]>();
  },

  /**
   * findCaregiverClashesIn — the same question for MANY caregivers at once.
   * WHY IT EXISTS: the matcher has a candidate shortlist and must drop anyone
   * already committed in the window. Asking per caregiver is N queries inside
   * a loop; one `$in` answers the whole shortlist in a single round trip.
   */
  findCaregiverClashesIn: async (
    caregiverIds: string[],
    start: Date,
    end: Date,
  ): Promise<Booking[]> => {
    if (!caregiverIds.length) return [];
    return BookingModel.find({
      caregiverId: { $in: caregiverIds },
      status: { $in: CAREGIVER_BLOCKING_STATUSES },
      scheduledFor: { $lt: end },
      endsAt: { $gt: start },
    }).lean<Booking[]>();
  },

  /**
   * confirmIfOffered — the atomic Accept.
   * HOW IT WORKS: `{ _id, status: "offered" }` is the guard. Mongo evaluates
   * the filter and applies the update as ONE operation on ONE document, so
   * the winner is decided by the database, not by our process. A `null`
   * return means the booking was no longer `offered` — somebody else won, or
   * the family cancelled — and the caller turns that into a 409.
   *
   * This is the correct fix for the race. A read-then-write with a JavaScript
   * `if` between the two steps is not, no matter how short the gap looks.
   */
  confirmIfOffered: async (
    bookingId: string,
    caregiverId: string | Types.ObjectId,
  ): Promise<Booking | null> =>
    BookingModel.findOneAndUpdate(
      { _id: bookingId, status: "offered" },
      { status: "confirmed", caregiverId, confirmedAt: new Date() },
      { new: true },
    ).lean<Booking>(),

  /**
   * transitionIfStatus — the generic conditional status change.
   * HOW IT WORKS: every lifecycle move in this module goes through here, with
   * the set of statuses it is legal to move FROM in the filter. Two callers
   * racing to advance the same booking therefore produce one winner and one
   * `null`, and an event handler that is retried after it already succeeded
   * gets `null` rather than applying its side effects twice.
   *
   * `guard` folds further conditions into the SAME filter, so a caller can
   * make the update conditional on a field other than status without losing
   * atomicity. The matcher claims a booking on `matchAttempts` that way,
   * which is how two matchers running at once cannot both fan out offers for
   * the same attempt.
   */
  transitionIfStatus: async (
    bookingId: string,
    from: readonly BookingStatus[],
    patch: Partial<NewBooking>,
    guard: FilterQuery<Booking> = {},
  ): Promise<Booking | null> =>
    BookingModel.findOneAndUpdate(
      { ...guard, _id: bookingId, status: { $in: from } },
      { $set: patch },
      { new: true },
    ).lean<Booking>(),

  /**
   * findCommittedFromFor — a caregiver's future commitments.
   * Used when a caregiver is suspended or releases work: these are exactly
   * the bookings that must go back into matching.
   */
  findCommittedFromFor: async (caregiverId: string, from: Date): Promise<Booking[]> =>
    BookingModel.find({
      caregiverId,
      status: { $in: CAREGIVER_BLOCKING_STATUSES },
      scheduledFor: { $gte: from },
    })
      .sort({ scheduledFor: 1 })
      .lean<Booking[]>(),

  /**
   * countCommittedBetween — how many jobs a caregiver already has in a window.
   * Used by the matcher's third ranking key ("fewest jobs today"), so work is
   * spread across the roster instead of piling onto whoever is closest.
   */
  countCommittedBetween: async (caregiverId: string, from: Date, to: Date): Promise<number> =>
    BookingModel.countDocuments({
      caregiverId,
      status: { $in: CAREGIVER_BLOCKING_STATUSES },
      scheduledFor: { $gte: from, $lte: to },
    }),

  countByStatus: async (status: BookingStatus): Promise<number> =>
    BookingModel.countDocuments({ status }),

  /**
   * existsActiveForPair — "is caregiver X working with elder Y right now?".
   * WHY IT EXISTS: elder-service asks this before it hands a caregiver the
   * care plan, and it must not read our collection to find out. The window is
   * padded by `graceMs` so a caregiver who arrives early, or is running late
   * writing up notes, can still open the brief.
   */
  existsActiveForPair: async (
    caregiverId: string,
    elderId: string,
    at: Date,
    graceMs: number,
  ): Promise<boolean> => {
    const found = await BookingModel.exists({
      caregiverId,
      elderId,
      status: { $in: CAREGIVER_BLOCKING_STATUSES },
      scheduledFor: { $lte: new Date(at.getTime() + graceMs) },
      endsAt: { $gte: new Date(at.getTime() - graceMs) },
    });
    return found !== null;
  },

  /**
   * existsForRecurrenceAt — has this rule already produced this occurrence?
   * The unique partial index on { recurrenceId, scheduledFor } is the real
   * guarantee; this check just keeps the generator from doing work it will
   * only have to throw away.
   */
  existsForRecurrenceAt: async (recurrenceId: string, scheduledFor: Date): Promise<boolean> => {
    const found = await BookingModel.exists({ recurrenceId, scheduledFor });
    return found !== null;
  },

  // =========================================================================
  // Assignment offers
  // =========================================================================

  /**
   * offerCreateMany — write the whole fan-out in one round trip.
   * `insertMany` with `ordered: false` keeps going if one row fails, which
   * matters because a partially-offered booking is still workable.
   */
  offerCreateMany: async (offers: NewAssignmentOfferInput[]): Promise<AssignmentOffer[]> => {
    if (!offers.length) return [];
    const docs = await AssignmentOfferModel.insertMany(offers, { ordered: false });
    return docs.map((doc) => doc.toObject() as AssignmentOffer);
  },

  /**
   * offerFindPageForCaregiver — the caregiver's offer inbox.
   * `openOnly` filters on BOTH status and deadline: an offer the sweeper has
   * not marked `expired` yet is already dead, and must never be shown as
   * actionable.
   */
  offerFindPageForCaregiver: async (
    caregiverId: string,
    openOnly: boolean,
    skip: number,
    limit: number,
  ): Promise<[AssignmentOffer[], number]> => {
    const where: FilterQuery<AssignmentOffer> = {
      caregiverId,
      ...(openOnly ? { status: "offered", expiresAt: { $gt: new Date() } } : {}),
    };
    return Promise.all([
      AssignmentOfferModel.find(where)
        .sort({ offeredAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<AssignmentOffer[]>(),
      AssignmentOfferModel.countDocuments(where),
    ]);
  },

  /** The one live offer a caregiver holds for a booking, if any. */
  offerFindOpen: async (bookingId: string, caregiverId: string): Promise<AssignmentOffer | null> =>
    AssignmentOfferModel.findOne({
      bookingId,
      caregiverId,
      status: "offered",
      expiresAt: { $gt: new Date() },
    }).lean<AssignmentOffer>(),

  offerFindForBooking: async (bookingId: string): Promise<AssignmentOffer[]> =>
    AssignmentOfferModel.find({ bookingId }).sort({ offeredAt: 1 }).lean<AssignmentOffer[]>(),

  /**
   * offerCountOpen — is anyone still considering this booking?
   * Asked after every decline: if the answer is zero the booking must go back
   * to matching rather than sit in `offered` with nobody looking at it.
   */
  offerCountOpen: async (bookingId: string): Promise<number> =>
    AssignmentOfferModel.countDocuments({
      bookingId,
      status: "offered",
      expiresAt: { $gt: new Date() },
    }),

  /**
   * offerRespond — record accept / decline / expire, once.
   * HOW IT WORKS: the filter requires the offer to still be `offered`, so a
   * double-tapped Decline updates one row and returns `null` the second time.
   * The caller uses that null to skip the follow-on work (the re-match).
   */
  offerRespond: async (
    offerId: string,
    status: OfferStatus,
    patch: { declineReason?: string | null } = {},
  ): Promise<AssignmentOffer | null> =>
    AssignmentOfferModel.findOneAndUpdate(
      { _id: offerId, status: "offered" },
      { $set: { status, respondedAt: new Date(), ...patch } },
      { new: true },
    ).lean<AssignmentOffer>(),

  /**
   * offerExpireOthers — close the losing offers when someone accepts.
   * `caregiverId: { $ne: winner }` leaves the winner's own offer alone; it is
   * marked `accepted` separately, so the history shows who took the job.
   */
  offerExpireOthers: async (bookingId: string, winnerCaregiverId: string): Promise<number> => {
    const result = await AssignmentOfferModel.updateMany(
      { bookingId, caregiverId: { $ne: winnerCaregiverId }, status: "offered" },
      { $set: { status: "expired", respondedAt: new Date() } },
    );
    return result.modifiedCount;
  },

  /** Close every open offer on a booking — used when it is cancelled. */
  offerExpireAll: async (bookingId: string): Promise<number> => {
    const result = await AssignmentOfferModel.updateMany(
      { bookingId, status: "offered" },
      { $set: { status: "expired", respondedAt: new Date() } },
    );
    return result.modifiedCount;
  },

  /**
   * offerFindDue — the expiry sweeper's query: open offers past their
   * deadline. Bounded by `limit` so one sweep cannot pull an unbounded
   * backlog into memory.
   */
  offerFindDue: async (now: Date, limit: number): Promise<AssignmentOffer[]> =>
    AssignmentOfferModel.find({ status: "offered", expiresAt: { $lte: now } })
      .sort({ expiresAt: 1 })
      .limit(limit)
      .lean<AssignmentOffer[]>(),

  offerExpireByIds: async (offerIds: string[]): Promise<number> => {
    if (!offerIds.length) return 0;
    const result = await AssignmentOfferModel.updateMany(
      { _id: { $in: offerIds }, status: "offered" },
      { $set: { status: "expired", respondedAt: new Date() } },
    );
    return result.modifiedCount;
  },

  // =========================================================================
  // Recurrence rules
  // =========================================================================

  recurrenceCreate: async (data: NewRecurrenceRuleInput): Promise<RecurrenceRule> => {
    const doc = await RecurrenceRuleModel.create(data);
    return doc.toObject() as RecurrenceRule;
  },

  recurrenceFindById: async (id: string): Promise<RecurrenceRule | null> =>
    RecurrenceRuleModel.findById(id).lean<RecurrenceRule>(),

  recurrenceFindPage: async (
    where: FilterQuery<RecurrenceRule>,
    skip: number,
    limit: number,
  ): Promise<[RecurrenceRule[], number]> =>
    Promise.all([
      RecurrenceRuleModel.find(where)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<RecurrenceRule[]>(),
      RecurrenceRuleModel.countDocuments(where),
    ]),

  /** Every rule the generator must consider on this pass. */
  recurrenceFindActive: async (now: Date, limit = 500): Promise<RecurrenceRule[]> =>
    RecurrenceRuleModel.find({
      active: true,
      startsOn: { $lte: now },
      $or: [{ endsOn: null }, { endsOn: { $gte: now } }],
    })
      .limit(limit)
      .lean<RecurrenceRule[]>(),

  recurrenceUpdate: async (
    id: string,
    patch: Partial<NewRecurrenceRule>,
  ): Promise<RecurrenceRule | null> =>
    RecurrenceRuleModel.findByIdAndUpdate(id, patch, { new: true }).lean<RecurrenceRule>(),

  /**
   * recurrenceDeactivate — stop future occurrences.
   * The guard `active: true` makes a repeated DELETE idempotent, and already
   * generated occurrences are deliberately left in place: cancelling them is
   * a separate decision with a fee policy attached.
   */
  recurrenceDeactivate: async (id: string): Promise<RecurrenceRule | null> =>
    RecurrenceRuleModel.findOneAndUpdate(
      { _id: id, active: true },
      { $set: { active: false } },
      { new: true },
    ).lean<RecurrenceRule>(),
};
