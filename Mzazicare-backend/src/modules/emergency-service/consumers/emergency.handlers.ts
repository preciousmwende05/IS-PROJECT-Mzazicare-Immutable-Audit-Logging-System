/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 *
 * How U-CS 72 reacts to the rest of the system. src/server.ts imports this
 * file for its side effects, so every `on()` here is registered at boot.
 *
 * Handlers must be IDEMPOTENT: a failed job is retried, and the same event can
 * arrive twice. Each source event maps to a unique `sourceKey`, so it can open
 * at most one emergency, ever.
 *
 * Expected gaps (a module not built yet, an unknown visit) are logged inside
 * the service and never thrown: a throw here would make the event bus retry
 * every OTHER module's handler for the same event too.
 */

import { on } from "@/shared/events/bus";
import { emergencyService } from "@/modules/emergency-service/services/emergency.service";

on("visit.missed", async ({ visitId, bookingId }) => {
  await emergencyService.handleVisitMissed(visitId, bookingId);
});

on("visit.geofence.breached", async ({ visitId, distanceMeters }) => {
  await emergencyService.handleGeofenceBreach(visitId, distanceMeters);
});
