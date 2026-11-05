/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

import { Worker, type Job } from "bullmq";

import logger from "@/shared/config/logger";
import { redisConnection } from "@/shared/queues/connection";
import { visitQueue } from "@/shared/queues";
import { MISSED_SWEEP_EVERY_MS } from "@/modules/visit-service/services/visit.constants";
import { visitService } from "@/modules/visit-service/services/visit.service";

/** Job names on the `visit` queue. */
export const VISIT_JOBS = {
  sweepMissed: "sweep-missed",
} as const;

/**
 * Drains the queue this module owns. Started from src/server.ts.
 *
 * One repeating job: the missed-visit sweep (docs §4.4), every 10 minutes.
 * The rule lives in `visitService.sweepMissed`, so it can be run without Redis;
 * this file only schedules it and calls it.
 */
export function startVisitWorker() {
  // A fixed jobId makes this safe to run on every boot: BullMQ keys a repeating
  // job on its name, id and interval, so a restart does not stack schedules.
  visitQueue
    .add(
      VISIT_JOBS.sweepMissed,
      {},
      { jobId: "visit:sweep:missed", repeat: { every: MISSED_SWEEP_EVERY_MS } },
    )
    .catch((err) => logger.error(`[visit] could not schedule the missed-visit sweep: ${err}`));

  const worker = new Worker(
    "visit",
    async (job: Job) => {
      if (job.name === VISIT_JOBS.sweepMissed) {
        const result = await visitService.sweepMissed(new Date());
        // Quiet when there is nothing to do: it runs every ten minutes, all day.
        if (result.missed || result.failed) {
          logger.info(
            `[visit] missed-visit sweep: ${result.missed} missed, ${result.failed} failed`,
          );
        }
        return result;
      }

      logger.warn(`[visit] ignoring unknown job ${job.name}`);
    },
    // One at a time: a sweep that overruns must not overlap the next one.
    { connection: redisConnection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => logger.error(`[visit] ${job?.name} failed: ${err.message}`));

  logger.info("[visit] worker started, missed-visit sweep every 10 minutes");
  return worker;
}
