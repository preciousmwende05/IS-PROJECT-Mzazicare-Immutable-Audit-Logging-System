/**
 * U-CS 74 — Care Visit Reporting & Feedback System
 * Owner(s): Marsa Fatuma Omar
 */

/**
 * How U-CS 74 reacts to the rest of the system.
 *
 * src/server.ts imports this file for its side effects, so every `on()` here
 * is registered at boot. Handlers must be IDEMPOTENT — a failed job is
 * retried, so the same event can arrive twice.
 *
 * TODO(report): subscribe to the events this module cares about.
 *
 * import { on } from "@/shared/events/bus";
 * import { reportService } from "@/modules/report-service/services/report.service";
 *
 * on("booking.confirmed", async ({ bookingId, caregiverId }) => {
 *   await reportService.handleBookingConfirmed(bookingId, caregiverId);
 * });
 */
export {};
