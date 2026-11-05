/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * Everything this module hands to a QUEUE, in one place: its own background
 * work (matching, the offer-expiry sweep, recurrence generation) and the
 * notifications it asks U-CS 76 to deliver.
 *
 * WHY IT IS ITS OWN FILE, not part of booking.service:
 *   the worker must import the service (to do the work), and the service must
 *   be able to enqueue (to ask for it). Putting the enqueue helpers here
 *   breaks what would otherwise be an import cycle — service → jobs, worker →
 *   jobs + service, and nothing points back.
 *
 * QUEUE OR EVENT?
 *   A queue is for work: "go and find a caregiver", "send this SMS". It is
 *   addressed, retried, and someone is expected to do it.
 *   The event bus is for facts: "this booking was confirmed". It is broadcast
 *   and the publisher does not care who listens.
 *   Matching is work. `booking.confirmed` is a fact. Both appear in this
 *   module and they are not interchangeable.
 */

import type { JobsOptions } from "bullmq";

import logger from "@/shared/config/logger";
import { bookingQueue, notificationsQueue } from "@/shared/queues";
import type { Role } from "@/shared/types";

// ---------------------------------------------------------------------------
// Job names — the contract between this file and booking.worker.ts
// ---------------------------------------------------------------------------
export const BOOKING_JOBS = {
  /** Find and offer caregivers for one booking. */
  match: "match",
  /** Sweep: close offers whose deadline passed, and re-match what they left. */
  expireOffers: "expire-offers",
  /** Sweep: top the rolling 30-day window of recurring occurrences back up. */
  generateRecurrences: "generate-recurrences",
} as const;

export type MatchJobData = { bookingId: string; reason?: string };

// How often the two sweeps run. A minute is the resolution the offer deadline
// needs: an offer expiring "in 15 minutes" may in practice last 15:59, which
// is fine — it is the RE-MATCH that must not be forgotten, not the exact
// second the offer died (every read already filters on `expiresAt`).
const OFFER_SWEEP_EVERY_MS = 60_000;
// Recurrence generation only has to stay ahead of a 30-day horizon, so hourly
// is plenty and keeps the write load off the hour-zero spike.
const RECURRENCE_SWEEP_EVERY_MS = 60 * 60_000;

/**
 * enqueueMatch — ask the matcher to staff a booking.
 * HOW IT WORKS: a plain add, with an optional delay for the "retry after the
 * offers all lapsed" path. No job-id de-duplication: two match jobs for the
 * same booking are harmless because the matcher CLAIMS the booking with a
 * conditional update on `matchAttempts` before it does anything, so the
 * second job finds nothing to claim and stops.
 *
 * `reason` is carried purely so the logs can answer "why did this re-match?".
 */
export const enqueueMatch = async (
  bookingId: string,
  options: { delayMs?: number; reason?: string } = {},
): Promise<void> => {
  const jobOptions: JobsOptions = options.delayMs ? { delay: options.delayMs } : {};
  await bookingQueue.add(BOOKING_JOBS.match, { bookingId, reason: options.reason }, jobOptions);
};

/**
 * scheduleBookingSweeps — register the two repeatable jobs.
 * Called once from `startBookingWorker`. The fixed `jobId` is what makes it
 * safe to call on every boot: BullMQ keys a repeatable job on its name, id
 * and interval, so restarting the API does not accumulate duplicate schedules.
 *
 * WHY THE OFFER SWEEP IS NOT A PER-OFFER DELAYED JOB: one sweep every minute
 * is O(1) jobs regardless of load, cannot leak a job per offer, and — more
 * importantly — recovers by itself. A delayed job lost to a Redis flush is
 * gone, and the booking sits in `offered` forever with nobody told.
 */
export const scheduleBookingSweeps = async (): Promise<void> => {
  await bookingQueue.add(
    BOOKING_JOBS.expireOffers,
    {},
    { jobId: "booking:sweep:offers", repeat: { every: OFFER_SWEEP_EVERY_MS } },
  );
  await bookingQueue.add(
    BOOKING_JOBS.generateRecurrences,
    {},
    { jobId: "booking:sweep:recurrences", repeat: { every: RECURRENCE_SWEEP_EVERY_MS } },
  );
  logger.info("[booking] sweeps scheduled (offer expiry 1m, recurrence generation 1h)");
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Who a notification is for. Ids are passed through untouched — resolving a
 * caregiver id to a phone number is U-CS 76's job (via U-CS 69), and doing it
 * here would mean reaching into another module for contact details.
 */
export type NotificationAudience = {
  userIds?: string[];
  caregiverIds?: string[];
  roles?: Role[];
};

export type BookingNotification = {
  template: string;
  audience: NotificationAudience;
  data: Record<string, unknown>;
  urgency?: "normal" | "high";
};

/**
 * notify — enqueue one notification, and never let it break the caller.
 * HOW IT WORKS: the add is awaited, but a failure is logged rather than
 * thrown. A family not being told about a confirmation is bad; a confirmation
 * being rolled back because the SMS queue hiccuped is worse — the caregiver
 * has already committed and the booking row is already correct.
 *
 * Failing softly is the right call HERE precisely because the state change is
 * already durable. It is not a licence to swallow errors elsewhere.
 */
export const notify = async (notification: BookingNotification): Promise<void> => {
  try {
    await notificationsQueue.add(notification.template, notification);
  } catch (err) {
    logger.error(`[booking] failed to enqueue ${notification.template}: ${(err as Error).message}`);
  }
};

/** The templates this module asks notification-service to deliver. */
export const BOOKING_TEMPLATES = {
  requested: "booking.requested",
  offer: "booking.offer",
  confirmedFamily: "booking.confirmed.family",
  confirmedCaregiver: "booking.confirmed.caregiver",
  unassigned: "booking.unassigned",
  cancelled: "booking.cancelled",
  rescheduled: "booking.rescheduled",
  reassigning: "booking.reassigning",
  assigned: "booking.assigned",
} as const;
