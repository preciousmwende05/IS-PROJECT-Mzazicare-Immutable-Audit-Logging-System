/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * Standing arrangements: "a carer every Tuesday and Thursday at 09:00 until
 * December". A RecurrenceRule is a TEMPLATE, not a booking. A generator turns
 * it into ORDINARY bookings, which then match, confirm, run and invoice
 * exactly like any other booking — nothing downstream needs to know they came
 * from a rule.
 *
 * ============================================================================
 * THE TWO DECISIONS THAT DEFINE THIS FILE
 * ============================================================================
 * 1. A ROLLING 30-DAY HORIZON, NOT AN INFINITE SERIES.
 *    An open-ended weekly rule would otherwise mean generating bookings until
 *    the heat death of the universe. The generator keeps the next 30 days
 *    filled and runs again every hour, so the window rolls forward on its
 *    own. A family sees a month of confirmed care, and the platform holds a
 *    bounded number of rows.
 *
 * 2. GENERATION IS IDEMPOTENT, AND THE DATABASE IS WHAT GUARANTEES IT.
 *    The unique partial index on `{ recurrenceId, scheduledFor }` makes a
 *    duplicate occurrence impossible, so the hourly sweep can re-cover the
 *    same 30 days as often as it likes. The pre-check in this file is only
 *    there to avoid doing work that the index would reject — the index is the
 *    guarantee, not the check.
 *
 * Stopping a rule stops FUTURE occurrences. It deliberately does not cancel
 * the ones already generated: those are real bookings with a caregiver
 * attached and a cancellation fee policy, and destroying them silently would
 * bypass both.
 */

import logger from "@/shared/config/logger";
import { publish } from "@/shared/events/bus";
import { ForbiddenError, NotFoundError } from "@/shared/errors";
import type { Paginated } from "@/shared/types";
import { addMinutes, DAY_MS, startOfDay } from "@/shared/utils/date.util";
import { buildPage, parsePagination } from "@/shared/utils/pagination.util";
import {
  type Booking,
  type NewBookingInput,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from "@/modules/booking-service/models/booking.model";
import { bookingRepository } from "@/modules/booking-service/repository/booking.repository";
import {
  assertElderAccess,
  assertMeetsServiceMinimum,
  isStaff,
  requireBookableService,
  scopeToActor,
  type Actor,
} from "@/modules/booking-service/services/booking.rules";
import { elderPort } from "@/modules/booking-service/services/booking.dependencies";
import { priceAtBooking } from "@/modules/booking-service/services/booking.pricing";
import { enqueueMatch } from "@/modules/booking-service/services/booking.jobs";

/** How far ahead occurrences are generated. The sweep rolls this forward. */
const HORIZON_DAYS = 30;

/** Rules processed per sweep, so one pass stays bounded. */
const RULES_PER_SWEEP = 500;

export type CreateRecurrenceInput = {
  elderId: string;
  serviceId: string;
  frequency: RecurrenceFrequency;
  daysOfWeek?: number[];
  timeOfDay: string;
  durationMinutes: number;
  startsOn: Date;
  endsOn?: Date;
  notes?: string;
};

/**
 * atTimeOfDay — a specific day plus "HH:mm" as one instant.
 * HOW IT WORKS: `startOfDay` normalises the date, then the hours and minutes
 * are set on it. The arithmetic is done in server local time on purpose — the
 * rule means "09:00 in Nairobi", and a family's Tuesday morning must not
 * drift by an hour when the clock changes or when the process runs in a
 * different timezone. Storing the time as "HH:mm" and rebasing it per day is
 * what makes that true; adding 7 × 86_400_000 milliseconds to a Date would
 * not be.
 */
const atTimeOfDay = (day: Date, timeOfDay: string): Date => {
  const [hours, minutes] = timeOfDay.split(":");
  const at = startOfDay(day);
  at.setHours(Number(hours ?? 0), Number(minutes ?? 0), 0, 0);
  return at;
};

/**
 * occurrencesBetween — every instant a rule fires in a window.
 * HOW IT WORKS: walk one day at a time from `from` to `to`, keep the days the
 * rule covers (all of them when `daily`, the listed weekdays when `weekly`),
 * and stamp the rule's time-of-day onto each. Instants before `from` are
 * dropped, which is what stops the current day's already-passed slot being
 * generated when the sweep runs in the afternoon.
 */
const occurrencesBetween = (rule: RecurrenceRule, from: Date, to: Date): Date[] => {
  const days = rule.daysOfWeek ?? [];
  const out: Date[] = [];

  for (let cursor = startOfDay(from); cursor <= to; cursor = new Date(cursor.getTime() + DAY_MS)) {
    if (rule.frequency === "weekly" && !days.includes(cursor.getDay())) continue;

    const at = atTimeOfDay(cursor, rule.timeOfDay);
    if (at < from || at > to) continue;
    out.push(at);
  }

  return out;
};

/** Mongo's duplicate-key error, which here means "already generated". */
const isDuplicateKey = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

export const bookingRecurrenceService = {
  /**
   * createRule — POST /bookings/recurring.
   * HOW IT WORKS: validates the arrangement ONCE (care-circle access, the
   * service is bookable, the duration clears its minimum) and then persists
   * the rule. The first batch of occurrences is generated immediately, so the
   * family sees a month of bookings appear rather than waiting up to an hour
   * for the sweep.
   */
  createRule: async (input: CreateRecurrenceInput, actor: Actor): Promise<RecurrenceRule> => {
    await assertElderAccess(input.elderId, actor);

    const service = await requireBookableService(input.serviceId);
    assertMeetsServiceMinimum(service, input.durationMinutes);

    const rule = await bookingRepository.recurrenceCreate({
      elderId: input.elderId as unknown as RecurrenceRule["elderId"],
      serviceId: input.serviceId as unknown as RecurrenceRule["serviceId"],
      createdBy: actor.id as unknown as RecurrenceRule["createdBy"],
      frequency: input.frequency,
      daysOfWeek: input.daysOfWeek ?? [],
      timeOfDay: input.timeOfDay,
      durationMinutes: input.durationMinutes,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      notes: input.notes ?? null,
      active: true,
    });

    const generated = await bookingRecurrenceService.generateForRule(rule);
    logger.info(
      `[booking] recurrence ${String(rule._id)} created, ${generated} occurrence(s) generated`,
    );

    return rule;
  },

  /** GET /bookings/recurring — the caller's standing arrangements. */
  listRules: async (
    filters: { elderId?: string; active?: boolean; page?: unknown; limit?: unknown },
    actor: Actor,
  ): Promise<Paginated<RecurrenceRule>> => {
    const { page, limit, skip } = parsePagination(filters);

    // Rules belong to an elder, so the same scoping as bookings applies —
    // minus the caregiver branch, since a caregiver has no standing
    // arrangements of their own to read.
    const scope = await scopeToActor(actor, { elderId: filters.elderId });
    if (!scope) return buildPage<RecurrenceRule>([], 0, page, limit);

    const where = {
      ...(scope.elderId ? { elderId: scope.elderId } : {}),
      ...(filters.active === undefined ? {} : { active: filters.active }),
    };

    const [items, total] = await bookingRepository.recurrenceFindPage(where, skip, limit);
    return buildPage(items, total, page, limit);
  },

  /**
   * stopRule — DELETE /bookings/recurring/:id.
   * Deactivates the rule so no further occurrences are generated. Occurrences
   * that already exist are left alone — see the file header. The conditional
   * `active: true` update makes a repeated DELETE a no-op rather than an
   * error.
   */
  stopRule: async (ruleId: string, actor: Actor): Promise<RecurrenceRule> => {
    const rule = await bookingRepository.recurrenceFindById(ruleId);
    if (!rule) throw new NotFoundError("Recurrence rule");

    if (!isStaff(actor.role) && String(rule.createdBy) !== actor.id) {
      // Not the creator: they must at least be in the elder's care circle.
      if (!(await elderPort.isInCareCircle(String(rule.elderId), actor.id))) {
        throw new NotFoundError("Recurrence rule");
      }
      if (actor.role === "caregiver") {
        throw new ForbiddenError("Only the family may stop a recurring booking");
      }
    }

    const stopped = await bookingRepository.recurrenceDeactivate(ruleId);
    return stopped ?? rule;
  },

  /**
   * generateForRule — top one rule's 30-day window back up.
   * HOW IT WORKS:
   *   1. Work out the window: from now (never the past) to the earlier of
   *      now + 30 days and the rule's own `endsOn`.
   *   2. Resolve the elder and the service ONCE for the whole batch. Every
   *      occurrence still gets its OWN snapshot of price and required skills,
   *      taken at generation time — which is this occurrence's booking time.
   *   3. For each instant: skip it if it already exists, skip it if the elder
   *      is already booked then, otherwise create the booking, announce it
   *      and hand it to the matcher.
   *
   * A clash is SKIPPED, not thrown. A generator is not a user: if a family
   * booked a one-off visit on top of their Tuesday slot, the right outcome is
   * one visit and a logged note, not a failed sweep that then fails to
   * generate everything after it.
   */
  generateForRule: async (rule: RecurrenceRule): Promise<number> => {
    const now = new Date();
    const horizon = new Date(now.getTime() + HORIZON_DAYS * DAY_MS);
    const until = rule.endsOn && rule.endsOn < horizon ? rule.endsOn : horizon;
    if (until <= now) return 0;

    const ruleId = String(rule._id);
    const elderId = String(rule.elderId);

    const elder = await elderPort.getById(elderId);
    if (!elder) {
      logger.warn(`[booking] recurrence ${ruleId} skipped — elder ${elderId} not found`);
      return 0;
    }

    const service = await requireBookableService(String(rule.serviceId));

    let created = 0;
    for (const scheduledFor of occurrencesBetween(rule, now, until)) {
      if (await bookingRepository.existsForRecurrenceAt(ruleId, scheduledFor)) continue;

      const endsAt = addMinutes(scheduledFor, rule.durationMinutes);
      const clashes = await bookingRepository.findClashing({ elderId }, scheduledFor, endsAt);
      if (clashes.length) {
        logger.debug(
          `[booking] recurrence ${ruleId} skipped ${scheduledFor.toISOString()} — clash`,
        );
        continue;
      }

      const data: NewBookingInput = {
        elderId: rule.elderId,
        serviceId: rule.serviceId,
        requestedBy: rule.createdBy,
        scheduledFor,
        durationMinutes: rule.durationMinutes,
        endsAt,
        location: elder.homeLocation as unknown as Booking["location"],
        priceCentsAtBooking: priceAtBooking(
          service.pricingUnit,
          service.basePriceCents,
          rule.durationMinutes,
        ),
        requiredSkillsAtBooking: service.requiredSkills,
        notes: rule.notes ?? null,
        recurrenceId: rule._id,
        status: "requested",
      };

      let booking: Booking;
      try {
        booking = await bookingRepository.create(data);
      } catch (err) {
        // The unique index rejected it: a concurrent sweep got there first.
        // That is the index doing its job, so it is not an error.
        if (isDuplicateKey(err)) continue;
        throw err;
      }

      await publish("booking.requested", {
        bookingId: String(booking._id),
        elderId,
        serviceId: String(booking.serviceId),
        scheduledFor: booking.scheduledFor.toISOString(),
      });
      await enqueueMatch(String(booking._id), { reason: "recurring occurrence" });
      created += 1;
    }

    return created;
  },

  /**
   * generateDue — the hourly sweep over every active rule.
   * One rule failing must not stop the others: a rule whose service has been
   * archived, or whose elder has been removed, is logged and skipped so the
   * remaining families still get their bookings.
   */
  generateDue: async (): Promise<{ rules: number; created: number }> => {
    const rules = await bookingRepository.recurrenceFindActive(new Date(), RULES_PER_SWEEP);
    let created = 0;

    for (const rule of rules) {
      try {
        created += await bookingRecurrenceService.generateForRule(rule);
      } catch (err) {
        logger.error(
          `[booking] recurrence ${String(rule._id)} generation failed: ${(err as Error).message}`,
        );
      }
    }

    if (created) {
      logger.info(
        `[booking] generated ${created} recurring occurrence(s) from ${rules.length} rule(s)`,
      );
    }
    return { rules: rules.length, created };
  },
};
