/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * Request-shape validation. Every schema answers ONE question: "is this
 * request well-formed?" — right types, right ranges, right enums, coherent
 * pairs of fields.
 *
 * It deliberately does NOT answer scheduling questions. "Is this caregiver
 * free on Tuesday?", "does the elder already have a booking then?" and "is
 * two hours' notice enough?" all need the database and the policy, and live
 * in the service layer.
 *
 * `validate` (shared/middleware) parses these against the request and REPLACES
 * body/params/query with the parsed result, so controllers receive typed,
 * coerced, extras-stripped data.
 */

import { z } from "zod";

import {
  BOOKING_STATUSES,
  RECURRENCE_FREQUENCIES,
} from "@/modules/booking-service/models/booking.model";

// ---------------------------------------------------------------------------
// Reusable field validators
// ---------------------------------------------------------------------------

// A MongoDB ObjectId is exactly 24 hex characters. Used for every id, so a
// malformed one fails here with a clean 422 instead of a 500 CastError later.
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

/**
 * futureDate — a date that is in the future WHEN THE REQUEST ARRIVES.
 *
 * Note what this is NOT: `z.coerce.date().min(new Date())`. That evaluates
 * `new Date()` once, when this module is first imported, and then compares
 * every request for the lifetime of the process against that frozen instant.
 * On a server that has been up for a week it would happily accept a booking
 * six days in the past. `.refine()` runs per request, so the comparison is
 * always against now.
 */
const futureDate = z.coerce
  .date()
  .refine((value) => value.getTime() > Date.now(), "Cannot book in the past");

// 15 minutes is the platform floor and 24 hours the ceiling. The BOOKED
// SERVICE may demand more than 15 (`minimumDurationMinutes`) — that is a
// catalog fact, so the service layer checks it, not this file.
const durationMinutes = z.coerce.number().int().min(15).max(1440);

// "HH:mm", 24-hour. Anchored so "9:5" and "24:00" are rejected.
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");

// Free text the family writes for the caregiver, or a cancellation reason.
const shortText = (max: number) => z.string().trim().max(max);

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

// A calendar range is capped: an unbounded "from 1970 to 2099" query would
// stream the whole collection through one response.
const MAX_CALENDAR_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

export const bookingValidation = {
  // Generic single-id param guard, reused by accept / byId / delete.
  byId: z.object({
    params: z.object({ id: objectId }),
  }),

  /**
   * POST / — create a booking.
   * The elder and the service are ids we then resolve through their owning
   * modules; `requestedBy` is NOT accepted from the body, ever. It comes from
   * the verified token, because identity in a request body is a forgery.
   */
  create: z.object({
    body: z.object({
      elderId: objectId,
      serviceId: objectId,
      scheduledFor: futureDate,
      durationMinutes,
      notes: shortText(1000).optional(),
    }),
  }),

  /**
   * GET / — the caller's bookings.
   * Note there is no `elderId`-free "give me everything" escape hatch: the
   * service scopes the query to what the caller may see, and these filters
   * only ever NARROW that scope.
   */
  list: z.object({
    query: z.object({
      status: z.enum(BOOKING_STATUSES).optional(),
      elderId: objectId.optional(),
      caregiverId: objectId.optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      ...pagination,
    }),
  }),

  /** PATCH /:id — edit the note to the caregiver (only while `requested`). */
  updateNotes: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      // `.nullable()` is how a family CLEARS a note. Omitting the field is a
      // different request ("change nothing"), which the service ignores.
      notes: shortText(1000).nullable(),
    }),
  }),

  /**
   * POST /:id/reschedule — move a booking.
   * Duration is optional: "same visit, an hour later" is the common case, and
   * re-sending an unchanged duration is an easy way to change it by mistake.
   */
  reschedule: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      scheduledFor: futureDate,
      durationMinutes: durationMinutes.optional(),
    }),
  }),

  /** POST /:id/cancel — the reason is optional for a family, but recorded. */
  cancel: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      reason: shortText(500).optional(),
    }),
  }),

  /** POST /:id/decline — a caregiver turning an offer down. */
  decline: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      reason: shortText(500).optional(),
    }),
  }),

  /**
   * POST /:id/assign — a coordinator force-assigning, bypassing offers.
   * The caregiver id is required: this endpoint exists precisely because a
   * human has decided WHO should take the job.
   */
  assign: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      caregiverId: objectId,
      reason: shortText(500).optional(),
    }),
  }),

  /** GET /offers — a caregiver's own open offers. */
  offers: z.object({
    query: z.object({
      // Open offers by default; `all` is for an audit/history screen.
      scope: z.enum(["open", "all"]).default("open"),
      ...pagination,
    }),
  }),

  /**
   * GET /calendar — a range view.
   * `.superRefine` checks the PAIR of fields, which no per-field rule can:
   * the range must run forwards and must not exceed 120 days.
   */
  calendar: z.object({
    query: z
      .object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        elderId: objectId.optional(),
        caregiverId: objectId.optional(),
      })
      .superRefine((value, ctx) => {
        if (value.to.getTime() <= value.from.getTime()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["to"],
            message: "`to` must be after `from`",
          });
        }
        if (value.to.getTime() - value.from.getTime() > MAX_CALENDAR_DAYS * DAY_MS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["to"],
            message: `Range cannot exceed ${MAX_CALENDAR_DAYS} days`,
          });
        }
      }),
  }),

  /**
   * POST /recurring — a standing arrangement.
   * Two paired rules the shape itself must enforce:
   *   - `weekly` is meaningless without at least one day of the week;
   *   - `endsOn`, when given, must be after `startsOn`.
   * Both are cross-field, hence `superRefine` rather than field validators.
   */
  createRecurring: z.object({
    body: z
      .object({
        elderId: objectId,
        serviceId: objectId,
        frequency: z.enum(RECURRENCE_FREQUENCIES),
        // 0 = Sunday … 6 = Saturday.
        daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
        timeOfDay,
        durationMinutes,
        startsOn: z.coerce.date(),
        endsOn: z.coerce.date().optional(),
        notes: shortText(1000).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.frequency === "weekly" && !value.daysOfWeek?.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["daysOfWeek"],
            message: "A weekly rule needs at least one day of the week",
          });
        }
        if (value.endsOn && value.endsOn.getTime() <= value.startsOn.getTime()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endsOn"],
            message: "`endsOn` must be after `startsOn`",
          });
        }
      }),
  }),

  /** GET /recurring — the caller's standing arrangements. */
  listRecurring: z.object({
    query: z.object({
      elderId: objectId.optional(),
      active: z
        .enum(["true", "false"])
        .transform((value) => value === "true")
        .optional(),
      ...pagination,
    }),
  }),
};
