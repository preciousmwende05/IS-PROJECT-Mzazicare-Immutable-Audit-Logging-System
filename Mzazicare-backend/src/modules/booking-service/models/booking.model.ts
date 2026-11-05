/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The ONLY place that knows how a Booking, an AssignmentOffer and a
 * RecurrenceRule look in the database. Three collections are owned here:
 *
 *   bookings           — the booking record and its lifecycle state
 *   assignment_offers   — "we asked caregiver X, they have 15 minutes to answer"
 *   recurrence_rules    — "every Tuesday and Thursday at 09:00 until December"
 *
 * Services and repositories never invent fields; they can only use the ones
 * declared here.
 *
 * TWO DESIGN DECISIONS WORTH READING BEFORE YOU CHANGE ANYTHING
 *
 * 1. `endsAt` is STORED, not derived.
 *    Clash detection asks "does any booking overlap [start, end)?". Mongo
 *    cannot index `scheduledFor + durationMinutes`, so a derived end time
 *    would force a collection scan on the hottest query in the module. We
 *    persist `endsAt` and keep it in lockstep with duration (the repository
 *    is the only writer, and every writer sets both).
 *
 * 2. `priceCentsAtBooking` and `requiredSkillsAtBooking` are SNAPSHOTS.
 *    catalog-service may reprice or re-scope a service tomorrow. An invoice
 *    raised against this booking must use the price the family was shown, and
 *    a re-match six hours from now must look for the skills that were
 *    required when the booking was made. Both are copied in at creation and
 *    never read live again.
 */

import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";

// ---------------------------------------------------------------------------
// Enums as const tuples
// ---------------------------------------------------------------------------
// Each enum is an `as const` array AND a derived TypeScript type, so the
// runtime schema validation and the compile-time union can never drift apart.

export const BOOKING_STATUSES = [
  "requested", // family submitted it, the matcher has not run yet
  "matching", // the matcher is looking for caregivers
  "offered", // offers are out, waiting for the first Accept
  "unassigned", // nobody eligible — a coordinator must intervene
  "confirmed", // a caregiver accepted (or a coordinator force-assigned)
  "in_progress", // visit-service checked the caregiver in
  "completed", // visit-service checked the caregiver out
  "cancelled", // terminal, by family / caregiver / coordinator
  "no_show", // terminal, the caregiver never arrived
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * Who cancelled. This is NOT the same question as "which user id" — the fee
 * policy is driven by the ROLE that cancelled, so it is stored as its own
 * field next to `cancelledByUserId`.
 */
export const CANCELLED_BY = ["family", "caregiver", "coordinator", "system"] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

export const OFFER_STATUSES = ["offered", "accepted", "declined", "expired"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const RECURRENCE_FREQUENCIES = ["daily", "weekly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/**
 * Statuses that occupy the ELDER's calendar. A booking in any of these states
 * means "someone is coming (or might come) to this elder in that window", so
 * a second booking in the same window is a double-booking of a real person.
 *
 * `unassigned` is deliberately included: we have not found a caregiver yet,
 * but the family has asked for that slot and a coordinator is working on it.
 */
export const ELDER_BLOCKING_STATUSES = [
  "requested",
  "matching",
  "offered",
  "unassigned",
  "confirmed",
  "in_progress",
] as const satisfies readonly BookingStatus[];

/**
 * Statuses that occupy the CAREGIVER's calendar. Shorter than the list above
 * on purpose: an `offered` booking has no caregiver committed to it, so an
 * open offer must never block that caregiver from being offered other work.
 * Only a commitment (`confirmed`) or an in-flight visit blocks them.
 */
export const CAREGIVER_BLOCKING_STATUSES = [
  "confirmed",
  "in_progress",
] as const satisfies readonly BookingStatus[];

/** The statuses from which nothing may change. A record here is immutable. */
export const TERMINAL_STATUSES = [
  "completed",
  "cancelled",
  "no_show",
] as const satisfies readonly BookingStatus[];

// ---------------------------------------------------------------------------
// Booking schema  → collection `bookings`
// ---------------------------------------------------------------------------
const bookingSchema = new Schema(
  {
    // Who the care is for. Owned by elder-service; we only hold the id.
    elderId: {
      type: Schema.Types.ObjectId,
      ref: "Elder",
      required: true,
      index: true,
    },

    // Which catalog service was booked. Owned by catalog-service.
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: "CareService",
      required: true,
    },

    // The assigned caregiver — null until someone accepts, and back to null
    // if they are suspended or release the job. Owned by caregiver-service.
    caregiverId: {
      type: Schema.Types.ObjectId,
      ref: "Caregiver",
      default: null,
      index: true,
    },

    // The family user who asked for it. Taken from the verified token, never
    // from the request body.
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: BOOKING_STATUSES,
      required: true,
      default: "requested",
      index: true,
    },

    // Start of the window. Indexed — every calendar and clash query sorts or
    // filters on it.
    scheduledFor: {
      type: Date,
      required: true,
      index: true,
    },

    // 15 minutes is the platform floor; the booked service may demand more
    // (`minimumDurationMinutes`), which the service layer enforces.
    durationMinutes: {
      type: Number,
      required: true,
      min: 15,
      max: 1440,
    },

    // End of the window. Stored, never recomputed — see the header note.
    endsAt: {
      type: Date,
      required: true,
      index: true,
    },

    // Copied from the elder's home location AT BOOKING TIME. If the elder
    // moves next month, this booking still happened where it happened.
    // GeoJSON order is [longitude, latitude].
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },

    // Integer cents, computed from the catalog price and the pricing unit at
    // booking time. billing-service invoices from THIS field.
    priceCentsAtBooking: {
      type: Number,
      required: true,
      min: 0,
    },

    // The catalog's `requiredSkills` at booking time. A re-match tomorrow
    // matches against what was required today, not what the catalog says then.
    requiredSkillsAtBooking: {
      type: [String],
      required: true,
      default: [],
    },

    // Free text from the family to the caregiver. Editable only while the
    // booking is still `requested`.
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    // --- cancellation block ------------------------------------------------
    // All four fields are written together in one update, or none of them.
    cancelledBy: {
      type: String,
      enum: CANCELLED_BY,
      default: null,
    },

    cancelledByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    cancellationReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    // Integer cents. 0 is a real, meaningful value ("cancelled in time, no
    // fee"); null means "this booking was never cancelled".
    cancellationFeeCents: {
      type: Number,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    // --- scheduling provenance --------------------------------------------
    // Set when this booking was generated from a RecurrenceRule. A generated
    // occurrence is an ORDINARY booking in every other respect.
    recurrenceId: {
      type: Schema.Types.ObjectId,
      ref: "RecurrenceRule",
      default: null,
    },

    // How many times the matcher has run for this booking. Capped by the
    // service so a booking nobody wants ends up `unassigned` in front of a
    // human instead of looping forever.
    matchAttempts: {
      type: Number,
      required: true,
      default: 0,
    },

    // The visit-service visit that was created for this booking, learned from
    // `visit.checked_in`. We store it because `visit.checked_out` carries only
    // a visitId — this is how we map that event back to a booking.
    visitId: {
      type: Schema.Types.ObjectId,
      ref: "Visit",
      default: null,
      index: true,
    },

    // Timestamps for the transitions the rest of the platform asks about.
    confirmedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "bookings" },
);

// --- Indexes ---------------------------------------------------------------
// Every one of these backs a query the module actually runs. Nothing is here
// "just in case": an unused index still costs a write on every insert.

// "What is on this elder's calendar?" — and the elder-side clash check.
bookingSchema.index({ elderId: 1, scheduledFor: 1 });

// "What is on this caregiver's calendar?" — and the caregiver-side clash
// check, plus `releaseUpcomingFor` when a caregiver is suspended.
bookingSchema.index({ caregiverId: 1, scheduledFor: 1 });

// The operations queue: "show me everything unassigned, soonest first" and
// the offer-expiry sweep's "which bookings are still `offered`?".
bookingSchema.index({ status: 1, scheduledFor: 1 });

// Distance-ranked matching ("who is near this booking?") needs a 2dsphere.
bookingSchema.index({ location: "2dsphere" });

// A recurrence rule may generate an occurrence for a given moment EXACTLY
// once. The unique index is what makes the generator safely re-runnable: a
// second pass over the same 30-day window hits a duplicate-key error per
// existing occurrence instead of creating twins. The partial filter keeps
// one-off bookings (recurrenceId = null) out of the index entirely.
bookingSchema.index(
  { recurrenceId: 1, scheduledFor: 1 },
  { unique: true, partialFilterExpression: { recurrenceId: { $type: "objectId" } } },
);

export type Booking = InferSchemaType<typeof bookingSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

// The full persisted shape, minus the timestamps Mongoose maintains itself.
export type NewBooking = Omit<InferSchemaType<typeof bookingSchema>, "createdAt" | "updatedAt">;

/**
 * What a caller must supply to create a booking: the facts that have no
 * sensible default. Everything else (status, matchAttempts, the cancellation
 * block, …) is filled in by the schema, so callers cannot get those wrong.
 */
export type NewBookingInput = Pick<
  NewBooking,
  | "elderId"
  | "serviceId"
  | "requestedBy"
  | "scheduledFor"
  | "durationMinutes"
  | "endsAt"
  | "location"
  | "priceCentsAtBooking"
  | "requiredSkillsAtBooking"
> &
  Partial<NewBooking>;

export type BookingDocument = HydratedDocument<Booking>;

export const BookingModel = model("Booking", bookingSchema);

// ---------------------------------------------------------------------------
// AssignmentOffer schema  → collection `assignment_offers`
// ---------------------------------------------------------------------------
// One row per "we asked this caregiver about this booking". The matcher writes
// three of them at a time; exactly one can ever become `accepted`, because the
// booking row — not this collection — is the thing being competed for.
const assignmentOfferSchema = new Schema(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },

    caregiverId: {
      type: Schema.Types.ObjectId,
      ref: "Caregiver",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: OFFER_STATUSES,
      required: true,
      default: "offered",
    },

    offeredAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },

    // The deadline. Past this moment the offer is dead whether or not the
    // sweeper has got to it yet — every read filters on `expiresAt > now`, so
    // a late sweep can only delay the RE-MATCH, never resurrect an offer.
    expiresAt: {
      type: Date,
      required: true,
    },

    respondedAt: {
      type: Date,
      default: null,
    },

    // Why the caregiver said no. Fed back to operations, not to the family.
    declineReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  { timestamps: true, collection: "assignment_offers" },
);

// "Which of my offers are still open?" — the caregiver's inbox.
assignmentOfferSchema.index({ caregiverId: 1, status: 1, expiresAt: 1 });

// "Is anyone still considering this booking?" — asked after every decline.
assignmentOfferSchema.index({ bookingId: 1, status: 1 });

// The expiry sweeper's query: open offers whose deadline has passed.
assignmentOfferSchema.index({ status: 1, expiresAt: 1 });

export type AssignmentOffer = InferSchemaType<typeof assignmentOfferSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewAssignmentOffer = Omit<
  InferSchemaType<typeof assignmentOfferSchema>,
  "createdAt" | "updatedAt"
>;
export type NewAssignmentOfferInput = Pick<
  NewAssignmentOffer,
  "bookingId" | "caregiverId" | "expiresAt"
> &
  Partial<NewAssignmentOffer>;
export type AssignmentOfferDocument = HydratedDocument<AssignmentOffer>;

export const AssignmentOfferModel = model("AssignmentOffer", assignmentOfferSchema);

// ---------------------------------------------------------------------------
// RecurrenceRule schema  → collection `recurrence_rules`
// ---------------------------------------------------------------------------
// The rule is NOT a booking. It is a template the generator reads to create
// ordinary bookings a rolling 30 days ahead. Stopping a rule therefore stops
// FUTURE occurrences and leaves the already-generated ones alone — cancelling
// those is a separate, explicit decision.
const recurrenceRuleSchema = new Schema(
  {
    elderId: {
      type: Schema.Types.ObjectId,
      ref: "Elder",
      required: true,
      index: true,
    },

    serviceId: {
      type: Schema.Types.ObjectId,
      ref: "CareService",
      required: true,
    },

    // The family user who created the rule. Every generated occurrence is
    // attributed to them, so the audit trail never has an ownerless booking.
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    frequency: {
      type: String,
      enum: RECURRENCE_FREQUENCIES,
      required: true,
    },

    // 0 = Sunday … 6 = Saturday. Required for `weekly`; ignored for `daily`.
    daysOfWeek: {
      type: [Number],
      required: true,
      default: [],
    },

    // "HH:mm" in server local time. Stored as a string rather than a Date
    // because a time-of-day has no date, and rebasing a Date every day is how
    // recurrence generators end up an hour off after a clock change.
    timeOfDay: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },

    durationMinutes: {
      type: Number,
      required: true,
      min: 15,
      max: 1440,
    },

    startsOn: {
      type: Date,
      required: true,
    },

    // null = open-ended. The generator's 30-day horizon is what keeps an
    // open-ended rule finite.
    endsOn: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    active: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  { timestamps: true, collection: "recurrence_rules" },
);

// The generator's sweep: every active rule, oldest first.
recurrenceRuleSchema.index({ active: 1, startsOn: 1 });

export type RecurrenceRule = InferSchemaType<typeof recurrenceRuleSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewRecurrenceRule = Omit<
  InferSchemaType<typeof recurrenceRuleSchema>,
  "createdAt" | "updatedAt"
>;
export type NewRecurrenceRuleInput = Pick<
  NewRecurrenceRule,
  "elderId" | "serviceId" | "createdBy" | "frequency" | "timeOfDay" | "durationMinutes" | "startsOn"
> &
  Partial<NewRecurrenceRule>;
export type RecurrenceRuleDocument = HydratedDocument<RecurrenceRule>;

export const RecurrenceRuleModel = model("RecurrenceRule", recurrenceRuleSchema);
