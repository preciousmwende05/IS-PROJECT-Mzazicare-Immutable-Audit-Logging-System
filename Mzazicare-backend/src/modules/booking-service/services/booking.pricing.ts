/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The two money decisions this module makes: what a booking costs when it is
 * created, and what a cancellation costs when it is cancelled.
 *
 * They live in their own file for two reasons. They are pure functions of
 * their inputs — no database, no clock beyond the `now` they are handed — so
 * they are the easiest part of the module to reason about and to test. And
 * they are what the business will want changed: a policy argument should end
 * in an edit to one named constant here, not an expedition through the
 * service layer.
 *
 * Every amount is an INTEGER NUMBER OF CENTS. Rounding happens once, at the
 * point of calculation, and never again. A float would eventually make a
 * billing total disagree with the audit trail by a cent, and then nobody
 * trusts either.
 */

import { multiplyMoney } from "@/shared/utils/money.util";
import { HOUR_MS } from "@/shared/utils/date.util";
import type { CancelledBy } from "@/modules/booking-service/models/booking.model";
import type { PricingUnit } from "@/modules/booking-service/services/booking.dependencies";

/** Cancel earlier than this many hours before the visit and there is no fee. */
export const FREE_CANCELLATION_HOURS = 24;

/** Between the two thresholds, half the price is charged. */
export const PARTIAL_FEE_HOURS = 2;
export const PARTIAL_FEE_FACTOR = 0.5;

/**
 * priceAtBooking — what this booking costs, given the catalog's pricing unit.
 * HOW IT WORKS: the catalog states a base price and the unit it applies to,
 * so the duration only matters for some units.
 *   per_hour  → pro-rata by the minute. A 90-minute visit at KES 800/hour is
 *               120000 cents, not 80000.
 *   per_visit → the duration is irrelevant; one visit, one price.
 *   per_day   → per calendar day started, so a 26-hour booking counts two.
 * The switch is exhaustive over `PricingUnit`, so adding a unit to the
 * catalog's enum makes this a compile error rather than a silent default.
 */
export const priceAtBooking = (
  unit: PricingUnit,
  basePriceCents: number,
  durationMinutes: number,
): number => {
  switch (unit) {
    case "per_hour":
      return Math.round(basePriceCents * (durationMinutes / 60));
    case "per_day":
      return basePriceCents * Math.max(1, Math.ceil(durationMinutes / (24 * 60)));
    case "per_visit":
      return basePriceCents;
  }
};

/**
 * cancellationFee — the documented tier table, and nothing else.
 * HOW IT WORKS:
 *   a caregiver or the platform cancels → the family owes nothing, ever. A
 *   caregiver dropping out is not the family's fault, and charging for it
 *   would make the platform's own failure profitable;
 *   a family cancels with 24h notice or more → nothing. The slot can be
 *   resold;
 *   between 2 and 24 hours → half. The caregiver has probably turned other
 *   work down, but there is still time to fill part of the gap;
 *   under 2 hours → the full price. Nobody else can take that slot now.
 *
 * The 50% case goes through `multiplyMoney` so it rounds exactly the way
 * every other money calculation in the platform rounds.
 */
export const cancellationFee = (
  by: CancelledBy,
  priceCentsAtBooking: number,
  scheduledFor: Date,
  now: Date,
): number => {
  if (by !== "family") return 0;

  const hoursNotice = (scheduledFor.getTime() - now.getTime()) / HOUR_MS;
  if (hoursNotice >= FREE_CANCELLATION_HOURS) return 0;
  if (hoursNotice >= PARTIAL_FEE_HOURS) {
    return multiplyMoney({ amount: priceCentsAtBooking, currency: "KES" }, PARTIAL_FEE_FACTOR)
      .amount;
  }
  return priceCentsAtBooking;
};
