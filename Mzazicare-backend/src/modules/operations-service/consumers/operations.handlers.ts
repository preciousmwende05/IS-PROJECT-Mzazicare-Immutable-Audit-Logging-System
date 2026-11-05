/**
 * U-CS 77 — Care Operations Monitoring & Control System
 * Owner(s): Samuel Kahiga, Wachira Peter Githinji
 */

/**
 * How U-CS 77 reacts to the rest of the system.
 *
 * src/server.ts imports this file for its side effects, so every `on()` here
 * is registered at boot. Handlers must be IDEMPOTENT — a failed job is
 * retried, so the same event can arrive twice.
 *
 * TODO(operations): subscribe to the events this module cares about.
 *
 * import { on } from "@/shared/events/bus";
 * import { operationsService } from "@/modules/operations-service/services/operations.service";
 *
 * on("booking.confirmed", async ({ bookingId, caregiverId }) => {
 *   await operationsService.handleBookingConfirmed(bookingId, caregiverId);
 * });
 */
export {};
