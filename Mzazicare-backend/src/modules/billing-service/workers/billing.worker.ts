/**
 * U-CS 75 — Care Services Payment & Billing System
 * Owner(s): Mukabwa Gloria Joy, Getenga Jarvis Mokaya
 */

import { Worker, type Job } from "bullmq";

import logger from "@/shared/config/logger";
import { redisConnection } from "@/shared/queues/connection";

/**
 * Drains the queue this module owns. Started from src/server.ts.
 *
 * A worker does slow or external work (sending, calling an API, sweeping).
 * Announcing a fact is the event bus's job, not a queue's.
 */
export function startBillingWorker() {
  const worker = new Worker(
    "billing",
    async (job: Job) => {
      // TODO(billing): handle the job types this module enqueues.
      logger.debug(`[billing] job ${job.name}`);
    },
    { connection: redisConnection, concurrency: 5 },
  );

  worker.on("failed", (job, err) => logger.error(`[billing] ${job?.name} failed: ${err.message}`));

  logger.info("[billing] worker started");
  return worker;
}
