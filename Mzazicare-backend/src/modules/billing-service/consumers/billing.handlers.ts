/**
 * U-CS 75 — Care Services Payment & Billing System
 * Owner(s): Mukabwa Gloria Joy, Getenga Jarvis Mokaya
 */

/**
 * How U-CS 75 reacts to the rest of the system.
 *
 * src/server.ts imports this file for its side effects, so every `on()` here
 * is registered at boot. Handlers must be IDEMPOTENT — a failed job is
 * retried, so the same event can arrive twice.
 *
 * TODO(billing): subscribe to the events this module cares about.
 *
 * import { on } from "@/shared/events/bus";
 * import { billingService } from "@/modules/billing-service/services/billing.service";
 *
 * on("booking.confirmed", async ({ bookingId, caregiverId }) => {
 *   await billingService.handleBookingConfirmed(bookingId, caregiverId);
 * });
 */
export {};
