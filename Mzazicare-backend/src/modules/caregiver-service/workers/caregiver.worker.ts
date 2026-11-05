/**
 * U-CS 69 — Caregiver KYC & Approval Workflow System
 * Owner(s): Sharlet Kirui
 */
import { Queue, Worker } from "bullmq";

import logger from "@/shared/config/logger";
import { redisConnection } from "@/shared/queues/connection";
import { caregiverService } from "@/modules/caregiver-service/services/caregiver.service";
import { startCaregiverEventConsumer } from "@/modules/caregiver-service/consumers/caregiver.consumer";

const QUEUE_NAME = "caregiver-expiry";

// Owned by this module so shared/queues/index.ts stays untouched. Same defaults as the shared queues.
export const caregiverExpiryQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

/**
 * Two daily jobs on this queue, told apart by job name:
 *   "sweep"         06:00 Nairobi time: expire approved caregivers whose required
 *                   documents have lapsed, and publish caregiver.suspended so
 *                   booking-service releases their future bookings.
 *   "orphan-files"  03:00 Nairobi time: delete KYC files in RustFS that no document
 *                   references (uploads never registered, failed deletes).
 * The logic lives in caregiverService so it can be called without Redis.
 *
 * Called from src/server.ts like every other module's worker.
 */
export function startCaregiverWorker() {
  // The FIFO consumer for events from other modules (see consumers/caregiver.consumer.ts).
  startCaregiverEventConsumer();

  // Fixed jobId makes this idempotent: restarting the server does not stack schedules.
  caregiverExpiryQueue
    .add(
      "sweep",
      {},
      { repeat: { pattern: "0 6 * * *", tz: "Africa/Nairobi" }, jobId: "caregiver-expiry-sweep" },
    )
    .catch((err) => logger.error(`[caregiver] could not schedule expiry sweep: ${err}`));

  caregiverExpiryQueue
    .add(
      "orphan-files",
      {},
      { repeat: { pattern: "0 3 * * *", tz: "Africa/Nairobi" }, jobId: "caregiver-orphan-file-sweep" },
    )
    .catch((err) => logger.error(`[caregiver] could not schedule orphan file sweep: ${err}`));

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === "orphan-files") {
        const result = await caregiverService.runOrphanFileSweep(new Date());
        logger.info(`[caregiver] orphan file sweep done, scanned: ${result.scanned}, removed: ${result.removed}`);
        return result;
      }
      const result = await caregiverService.runExpirySweep(new Date());
      logger.info(`[caregiver] expiry sweep done, expired: ${result.expired}`);
      return result;
    },
    { connection: redisConnection },
  );

  logger.info("[caregiver] worker started, expiry sweep daily at 06:00 EAT, orphan file sweep daily at 03:00 EAT");
  worker.on("failed", (job, err) => logger.error(`[caregiver] ${job?.name} job failed (job ${job?.id}): ${err}`));
  return worker;
}