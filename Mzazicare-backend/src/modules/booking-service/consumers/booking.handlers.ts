/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * How this module reacts to the rest of the system. `src/server.ts` imports
 * this file for its side effects, so every `on()` below is registered at boot,
 * before the event worker starts draining.
 *
 * ============================================================================
 * THE SHAPE TO NOTICE: VISIT-SERVICE DRIVES OUR STATUS FORWARD
 * ============================================================================
 * booking-service does not poll visit-service to find out whether a caregiver
 * turned up. It cannot: only the person on the doorstep knows. So the last
 * three transitions of the lifecycle — in_progress, completed, no_show — are
 * pushed to us by U-CS 73's events, and this file is where the lifecycle stops
 * being ours to advance.
 *
 * ============================================================================
 * EVERY HANDLER HERE IS IDEMPOTENT — AND HOW
 * ============================================================================
 * A failed job is retried, and the event bus runs every handler for an event
 * in parallel, so the same payload WILL arrive twice eventually. None of these
 * handlers guards itself with an `if`; each calls a service method whose write
 * is a conditional update. The second delivery finds nothing in a legal source
 * state, changes nothing, and notifies nobody.
 *
 * That is the whole trick: idempotency is a property of the WRITE, not of a
 * check the handler remembered to do.
 */

import logger from "@/shared/config/logger";
import { on } from "@/shared/events/bus";
import { bookingService } from "@/modules/booking-service/services/booking.service";

/**
 * caregiver.suspended — release and re-match their future bookings.
 * A suspended caregiver must not remain assigned to a vulnerable person's
 * visit. `releaseUpcomingFor` unassigns every FUTURE confirmed booking, puts
 * it back into matching and tells each family. An in-flight visit is left
 * alone: a caregiver already in someone's home is not pulled out by an
 * administrative event.
 */
on("caregiver.suspended", async ({ caregiverId, reason }) => {
  const released = await bookingService.releaseUpcomingFor(
    caregiverId,
    `caregiver suspended: ${reason}`,
  );
  logger.info(`[booking] caregiver.suspended ${caregiverId} — released ${released} booking(s)`);
});

/**
 * visit.scheduled — the visit for a confirmed booking now exists. Stamp its id
 * so the caregiver can find the visit to check in to.
 */
on("visit.scheduled", async ({ visitId, bookingId }) => {
  await bookingService.attachVisit(bookingId, visitId);
});

/**
 * visit.checked_in — confirmed → in_progress.
 * We also stamp the visitId, which is the only way `visit.checked_out` (whose
 * payload carries a visitId and no bookingId) can later be mapped back to
 * this booking.
 *
 * Note that `verified` is NOT consulted here. Whether the check-in was inside
 * the geofence is visit-service's judgement to record and report on; from a
 * scheduling point of view the caregiver has started work either way, and
 * refusing to advance the booking would only hide the problem.
 */
on("visit.checked_in", async ({ visitId, bookingId }) => {
  await bookingService.markCheckedIn(bookingId, visitId);
});

/**
 * visit.checked_out — in_progress → completed.
 * Looked up by visitId, per the note above. `durationMinutes` on the event is
 * the ACTUAL time worked, which billing-service and report-service care about;
 * the booking keeps the duration that was scheduled, because that is what the
 * family agreed to and what was priced.
 */
on("visit.checked_out", async ({ visitId }) => {
  await bookingService.markCheckedOut(visitId);
});

/**
 * visit.missed — confirmed → no_show.
 * Terminal, and the family is told. A caregiver who never arrived is the worst
 * experience this platform can deliver; silence about it is worse.
 */
on("visit.missed", async ({ bookingId }) => {
  await bookingService.markMissed(bookingId);
});
