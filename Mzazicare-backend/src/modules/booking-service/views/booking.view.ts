/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The "public face" of this module's three documents. Every endpoint that
 * returns booking data passes it through a serializer here, so a field reaches
 * the client only if someone added it here on purpose.
 *
 * Two shaping rules this file applies consistently:
 *
 *   Dates out as ISO strings. JSON has no Date type, and Mongoose lean
 *   documents hold real Dates, so the conversion is explicit rather than left
 *   to JSON.stringify.
 *
 *   Coordinates out as { latitude, longitude }. Internally, and in Mongo,
 *   the order is GeoJSON's [longitude, latitude] — the single commonest bug
 *   in the platform. Naming the two numbers at the API boundary means no
 *   client can swap them by accident.
 */

import type {
  AssignmentOffer,
  Booking,
  RecurrenceRule,
} from "@/modules/booking-service/models/booking.model";

// ---------------------------------------------------------------------------
// BookingView — a booking as the client sees it
// ---------------------------------------------------------------------------
export type BookingView = {
  id: string;
  elderId: string;
  serviceId: string;
  caregiverId: string | null;
  requestedBy: string;
  status: Booking["status"];
  scheduledFor: string;
  endsAt: string;
  durationMinutes: number;
  location: { latitude: number; longitude: number };
  priceCentsAtBooking: number;
  requiredSkills: string[];
  notes: string | null;
  cancellation: {
    by: Booking["cancelledBy"];
    reason: string | null;
    feeCents: number | null;
    at: string | null;
  } | null;
  recurrenceId: string | null;
  visitId: string | null;
  confirmedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * coordinatesOf — read a GeoJSON coordinate pair defensively.
 * HOW IT WORKS: the schema types `coordinates` as `number[]`, so the compiler
 * cannot promise two entries are present (and `noUncheckedIndexedAccess`
 * rightly makes us say what happens when they are not). Index 0 is longitude
 * and index 1 is latitude, per GeoJSON.
 */
const coordinatesOf = (location: Booking["location"]) => ({
  longitude: location?.coordinates?.[0] ?? 0,
  latitude: location?.coordinates?.[1] ?? 0,
});

/**
 * serializeBooking — map a Booking document to the safe public shape.
 * HOW IT WORKS:
 *   1. Fields are copied one by one into a fresh object; nothing is spread
 *      from the document, so no future internal field rides along by accident.
 *   2. The four cancellation fields are folded into ONE nullable object.
 *      `cancellation === null` is the unambiguous signal "not cancelled",
 *      which is easier for a client than four independently-null fields.
 *      Note that `feeCents: 0` and `cancellation: null` mean very different
 *      things: "cancelled, no fee" versus "never cancelled".
 *   3. `matchAttempts` is NOT exposed. How hard we had to work to staff a
 *      booking is operational detail, not something the family needs.
 */
export const serializeBooking = (booking: Booking): BookingView => ({
  id: String(booking._id),
  elderId: String(booking.elderId),
  serviceId: String(booking.serviceId),
  caregiverId: booking.caregiverId ? String(booking.caregiverId) : null,
  requestedBy: String(booking.requestedBy),
  status: booking.status,
  scheduledFor: booking.scheduledFor.toISOString(),
  endsAt: booking.endsAt.toISOString(),
  durationMinutes: booking.durationMinutes,
  location: coordinatesOf(booking.location),
  priceCentsAtBooking: booking.priceCentsAtBooking,
  requiredSkills: [...(booking.requiredSkillsAtBooking ?? [])],
  notes: booking.notes ?? null,
  cancellation: booking.cancelledBy
    ? {
        by: booking.cancelledBy,
        reason: booking.cancellationReason ?? null,
        feeCents: booking.cancellationFeeCents ?? null,
        at: booking.cancelledAt?.toISOString() ?? null,
      }
    : null,
  recurrenceId: booking.recurrenceId ? String(booking.recurrenceId) : null,
  visitId: booking.visitId ? String(booking.visitId) : null,
  confirmedAt: booking.confirmedAt?.toISOString() ?? null,
  startedAt: booking.startedAt?.toISOString() ?? null,
  completedAt: booking.completedAt?.toISOString() ?? null,
  createdAt: booking.createdAt.toISOString(),
  updatedAt: booking.updatedAt.toISOString(),
});

// ---------------------------------------------------------------------------
// CalendarEntryView — the same booking, trimmed for a month grid
// ---------------------------------------------------------------------------
// GET /calendar can return hundreds of rows for a range. A calendar UI needs
// six fields to draw a block; sending the full view would be ~10x the bytes
// for data the grid throws away.
export type CalendarEntryView = {
  id: string;
  elderId: string;
  caregiverId: string | null;
  status: Booking["status"];
  start: string;
  end: string;
};

export const serializeCalendarEntry = (booking: Booking): CalendarEntryView => ({
  id: String(booking._id),
  elderId: String(booking.elderId),
  caregiverId: booking.caregiverId ? String(booking.caregiverId) : null,
  status: booking.status,
  start: booking.scheduledFor.toISOString(),
  end: booking.endsAt.toISOString(),
});

// ---------------------------------------------------------------------------
// OfferView — an assignment offer as the caregiver sees it
// ---------------------------------------------------------------------------
// `expiresIn` is computed, not stored: a caregiver's app wants "you have 8
// minutes", and a client clock that is two minutes out would compute that
// wrongly from the timestamp alone. It is clamped at 0 so an expired offer
// never reports negative time.
export type OfferView = {
  id: string;
  bookingId: string;
  caregiverId: string;
  status: AssignmentOffer["status"];
  offeredAt: string;
  expiresAt: string;
  expiresInSeconds: number;
  respondedAt: string | null;
  booking?: BookingView;
};

export const serializeOffer = (offer: AssignmentOffer, booking?: Booking): OfferView => ({
  id: String(offer._id),
  bookingId: String(offer.bookingId),
  caregiverId: String(offer.caregiverId),
  status: offer.status,
  offeredAt: offer.offeredAt.toISOString(),
  expiresAt: offer.expiresAt.toISOString(),
  expiresInSeconds: Math.max(0, Math.floor((offer.expiresAt.getTime() - Date.now()) / 1000)),
  respondedAt: offer.respondedAt?.toISOString() ?? null,
  ...(booking ? { booking: serializeBooking(booking) } : {}),
});

// ---------------------------------------------------------------------------
// RecurrenceRuleView — the standing arrangement, not its occurrences
// ---------------------------------------------------------------------------
export type RecurrenceRuleView = {
  id: string;
  elderId: string;
  serviceId: string;
  frequency: RecurrenceRule["frequency"];
  daysOfWeek: number[];
  timeOfDay: string;
  durationMinutes: number;
  startsOn: string;
  endsOn: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export const serializeRecurrenceRule = (rule: RecurrenceRule): RecurrenceRuleView => ({
  id: String(rule._id),
  elderId: String(rule.elderId),
  serviceId: String(rule.serviceId),
  frequency: rule.frequency,
  daysOfWeek: [...(rule.daysOfWeek ?? [])],
  timeOfDay: rule.timeOfDay,
  durationMinutes: rule.durationMinutes,
  startsOn: rule.startsOn.toISOString(),
  endsOn: rule.endsOn?.toISOString() ?? null,
  notes: rule.notes ?? null,
  active: rule.active,
  createdAt: rule.createdAt.toISOString(),
  updatedAt: rule.updatedAt.toISOString(),
});
