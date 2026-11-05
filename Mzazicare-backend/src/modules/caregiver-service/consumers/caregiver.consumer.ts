/**
 * U-CS 69 — Caregiver KYC & Approval Workflow System
 * Owner(s): Sharlet Kirui
 */
import { Queue, Worker, type Job } from "bullmq";

import logger from "@/shared/config/logger";
import { redisConnection } from "@/shared/queues/connection";
import type { EventPayload } from "@/shared/events/types";
import { bookingService } from "@/modules/booking-service/services/booking.service";
import { caregiverService } from "@/modules/caregiver-service/services/caregiver.service";

/**
 * The caregiver module's own event queue, processed strictly FIFO.
 *
 * The shared event bus runs up to 20 jobs at once, so it gives no ordering.
 * caregiver.handlers.ts only copies the events this module cares about into
 * this queue; all the work happens here, one event at a time, oldest first.
 *
 * What keeps it FIFO:
 *  1. BullMQ hands out waiting jobs in the order they were added.
 *  2. Worker concurrency 1, AND global concurrency 1 on the queue, so even
 *     with several API instances only one job is ever active.
 *  3. Retries happen INSIDE the processor. A BullMQ retry would move the
 *     job to the delayed set and let the next job overtake it.
 *
 * A job that still fails after MAX_ATTEMPTS is left in the failed set (kept
 * for inspection) and the queue moves on, so one bad event cannot stall every
 * caregiver's ratings and no-shows behind it.
 */

export type CaregiverEvent =
  | EventPayload<"visit.checked_in">
  | EventPayload<"visit.missed">
  | EventPayload<"feedback.submitted">;

const QUEUE_NAME = "caregiver-events";
const MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 1000; // 1s, 2s, 4s, 8s between attempts

export const caregiverEventQueue = new Queue<CaregiverEvent>(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1, // see 3. above
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

/**
 * Adds an event to the back of the queue. The jobId is derived from the event,
 * so if the shared bus redelivers it while the first copy is still queued,
 * BullMQ ignores the duplicate. (BullMQ ids cannot contain ":".)
 */
export async function enqueueCaregiverEvent(event: CaregiverEvent) {
  const jobId = `${event.type}_${event.visitId}`;
  await caregiverEventQueue.add(event.type, event, { jobId });
}

/**
 * The work for each event. Expected gaps (an unknown booking or visit) are
 * logged and skipped, never thrown: in a FIFO queue a throw is retried while
 * everything behind it waits.
 */
async function handle(event: CaregiverEvent): Promise<void> {
  switch (event.type) {
    case "visit.checked_in":
      // Remembered so the rating in a later feedback.submitted can be credited.
      await caregiverService.recordVisit(event.visitId, event.caregiverId);
      return;

    case "visit.missed": {
      const booking = await bookingService.getById(event.bookingId);
      if (!booking?.caregiverId) {
        logger.warn(`[caregiver-events] no-show for booking ${event.bookingId} has no caregiver, skipped`);
        return;
      }
      await caregiverService.recordNoShow(event.visitId, String(booking.caregiverId));
      return;
    }

    case "feedback.submitted": {
      const caregiverId = await caregiverService.caregiverIdForVisit(event.visitId);
      if (!caregiverId) {
        logger.warn(`[caregiver-events] feedback for visit ${event.visitId} matched no check-in, skipped`);
        return;
      }
      await caregiverService.recordRating(event.visitId, caregiverId, event.rating);
      return;
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries in place, so nothing behind this job runs until it succeeds or gives up. */
async function processInOrder(job: Job<CaregiverEvent>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await handle(job.data);
      return;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(
        `[caregiver-events] ${job.name} (job ${job.id}) attempt ${attempt} failed, retrying in ${delay}ms: ${(err as Error).message}`,
      );
      await sleep(delay);
    }
  }
}

/** Called from startCaregiverWorker, so src/server.ts needs no change. */
export function startCaregiverEventConsumer() {
  // Global, not just per worker: with several API instances each runs a worker.
  caregiverEventQueue
    .setGlobalConcurrency(1)
    .catch((err) => logger.error(`[caregiver-events] could not set global concurrency: ${err}`));

  const worker = new Worker<CaregiverEvent>(QUEUE_NAME, processInOrder, {
    connection: redisConnection,
    concurrency: 1,
  });

  worker.on("failed", (job, err) =>
    logger.error(
      `[caregiver-events] ${job?.name} (job ${job?.id}) gave up after ${MAX_ATTEMPTS} attempts, left in the failed set: ${err.message}`,
    ),
  );

  logger.info("[caregiver-events] FIFO consumer started");
  return worker;
}
