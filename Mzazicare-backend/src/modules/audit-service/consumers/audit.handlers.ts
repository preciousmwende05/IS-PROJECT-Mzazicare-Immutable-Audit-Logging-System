/**
 * U-CS 78 — Immutable Audit Logging & Compliance System
 * Owner(s): Precious Mwende Waweru, Anthony Atenya
 */

/**
 * How U-CS 78 reacts to the rest of the system.
 *
 * src/server.ts imports this file for its side effects, so every `on()` here
 * is registered at boot. Handlers must be IDEMPOTENT — a failed job is
 * retried, so the same event can arrive twice.
 *
 * TODO(audit): subscribe to the events this module cares about.
 *
 * import { on } from "@/shared/events/bus";
 * import { auditService } from "@/modules/audit-service/services/audit.service";
 *
 * on("booking.confirmed", async ({ bookingId, caregiverId }) => {
 *   await auditService.handleBookingConfirmed(bookingId, caregiverId);
 * });
 */
export {};

import { on } from "@/shared/events/bus";
import { auditService } from "@/modules/audit-service/services/audit.service";

// Idempotent: auditService.record recognises a retried event by its fingerprint.
on("audit.recorded", async (payload) => {
  await auditService.record(payload);
});