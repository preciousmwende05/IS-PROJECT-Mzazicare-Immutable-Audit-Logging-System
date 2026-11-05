/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 */

import { Worker, type Job } from "bullmq";

import logger from "@/shared/config/logger";
import { redisConnection } from "@/shared/queues/connection";
import {
  DISPATCH_LEVEL_JOB,
  emergencyService,
  type DispatchLevelJob,
} from "@/modules/emergency-service/services/emergency.service";

/**
 * Drains the `emergency` queue. Started from src/server.ts.
 *
 * Every level of the ladder, including level 0 on creation, is a job here.
 * Jobs are delayed jobs in Redis, never setTimeout, so a process restart does
 * not lose a live emergency. The handler re-reads the emergency and checks it
 * is still open before doing anything, so a job that arrives late is harmless.
 */
export function startEmergencyWorker() {
  const worker = new Worker(
    "emergency",
    async (job: Job) => {
      if (job.name === DISPATCH_LEVEL_JOB) {
        await emergencyService.handleDispatchJob(job.data as DispatchLevelJob);
        return;
      }
      logger.warn(`[emergency] unknown job ${job.name}`);
    },
    { connection: redisConnection, concurrency: 5 },
  );

  worker.on("failed", (job, err) =>
    logger.error(`[emergency] ${job?.name} failed: ${err.message}`),
  );

  logger.info("[emergency] worker started");
  return worker;
}
