/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The drain for the `booking` queue, started from `src/server.ts`. Three job
 * types, all declared in `services/booking.jobs.ts`:
 *
 *   match                 staff one booking (queued whenever one needs it)
 *   expire-offers         every minute: close lapsed offers, re-match
 *   generate-recurrences  every hour: keep the 30-day window topped up
 *
 * WHY THIS WORK IS ON A QUEUE AND NOT IN THE REQUEST
 *   Matching talks to caregiver-service and writes several rows. A family's
 *   POST must not wait on that, and — more importantly — a failure must be
 *   RETRIED rather than lost. Doing it in the request would mean a booking
 *   that exists but was never offered to anybody, with nothing left to
 *   re-drive it.
 *
 * WHY THE TWO SWEEPS ARE REPEATABLE JOBS AND NOT setInterval
 *   A repeatable job survives a restart, is visible in the queue, and does
 *   not fire once per process when the API runs several instances. An
 *   interval in application code has none of those properties.
 *
 * The offer-expiry sweep is the job people forget to write. Without it a
 * booking whose three offers all lapse stays `offered` for ever: the family
 * believe care is coming and nobody is looking for a caregiver.
 */

import { Worker, type Job } from "bullmq";

import logger from "@/shared/config/logger";
import { redisConnection } from "@/shared/queues/connection";
import {
  BOOKING_JOBS,
  scheduleBookingSweeps,
  type MatchJobData,
} from "@/modules/booking-service/services/booking.jobs";
import { bookingMatchingService } from "@/modules/booking-service/services/booking.matching.service";
import { bookingRecurrenceService } from "@/modules/booking-service/services/booking.recurrence.service";

/**
 * startBookingWorker — drain the queue and register the sweeps.
 * HOW IT WORKS: one worker handles all three job types, dispatching on the
 * job name. Concurrency 5, because the work is I/O bound on caregiver-service
 * and the CLAIM inside the matcher makes parallel jobs for the same booking
 * harmless.
 *
 * A job that throws is retried by BullMQ with backoff. That is why every
 * handler it calls is idempotent: a retry re-runs work that may already have
 * partly succeeded, and must not double-offer or double-notify.
 */
export function startBookingWorker() {
  const worker = new Worker(
    "booking",
    async (job: Job) => {
      switch (job.name) {
        case BOOKING_JOBS.match: {
          const { bookingId, reason } = job.data as MatchJobData;
          logger.debug(`[booking] matching ${bookingId}${reason ? ` (${reason})` : ""}`);
          await bookingMatchingService.match(bookingId);
          return;
        }

        case BOOKING_JOBS.expireOffers: {
          await bookingMatchingService.expireStaleOffers();
          return;
        }

        case BOOKING_JOBS.generateRecurrences: {
          await bookingRecurrenceService.generateDue();
          return;
        }

        default:
          // Not an error to swallow quietly: an unknown job name means
          // something enqueued work this worker was never taught to do, and
          // the log is how that gets noticed.
          logger.warn(`[booking] unknown job ${job.name}`);
      }
    },
    { connection: redisConnection, concurrency: 5 },
  );

  worker.on("failed", (job, err) => logger.error(`[booking] ${job?.name} failed: ${err.message}`));

  // Registering the sweeps here — rather than in server.ts — keeps "this
  // module's background work" in one place. It is safe on every boot: the
  // fixed job ids mean a restart re-registers the same two schedules instead
  // of adding a third.
  void scheduleBookingSweeps().catch((err) =>
    logger.error(`[booking] could not schedule sweeps: ${(err as Error).message}`),
  );

  logger.info("[booking] worker started");
  return worker;
}
