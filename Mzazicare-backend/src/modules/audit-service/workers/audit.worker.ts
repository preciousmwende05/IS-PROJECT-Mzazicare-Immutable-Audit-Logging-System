/**
 * U-CS 78 — Immutable Audit Logging & Compliance System
 * Owner(s): Precious Mwende Waweru, Anthony Atenya
 */

import { Worker, type Job } from "bullmq";

import logger from "@/shared/config/logger";
import { auditQueue } from "@/shared/queues";
import { redisConnection } from "@/shared/queues/connection";
import { anomalyService } from "@/modules/audit-service/services/anomaly.service";

export const AUDIT_JOBS = {
  verifyChain: "audit.verify-chain",
  detectAnomalies: "audit.detect-anomalies",
} as const;

/** How often the hash chain is re-verified on its own. */
export const VERIFY_EVERY_MS = 30 * 60_000;
/** How often the policy rules run and new alerts (from any source) are sent. */
export const DETECT_EVERY_MS = 2 * 60_000;

/**
 * Drains the queue this module owns. Started from src/server.ts.
 *
 * Two repeating jobs (fixed jobIds, so a restart never stacks schedules):
 *   verify-chain      every 30 min: integrity check; a break alerts admins + auditors
 *   detect-anomalies  every 2 min:  policy rules, then notify every new alert,
 *                                   including those the Isolation Forest inserted
 */
export function startAuditWorker() {
  const schedule = (name: string, every: number) =>
    auditQueue
      .add(name, {}, { jobId: name, repeat: { every }, removeOnComplete: 50, removeOnFail: 50 })
      .catch((err) => logger.error(`[audit] could not schedule ${name}: ${err}`));
  void schedule(AUDIT_JOBS.verifyChain, VERIFY_EVERY_MS);
  void schedule(AUDIT_JOBS.detectAnomalies, DETECT_EVERY_MS);

  const worker = new Worker(
    "audit",
    async (job: Job) => {
      if (job.name === AUDIT_JOBS.verifyChain) {
        const result = await anomalyService.verifyChainScheduled();
        await anomalyService.notifyPending();
        logger.info(`[audit] scheduled verification: ${result.intact ? "intact" : "BROKEN"} (${result.checkedEntries ?? "?"} entries)`);
        return result;
      }
      if (job.name === AUDIT_JOBS.detectAnomalies) {
        const raised = await anomalyService.detectRuleBreaches();
        const sent = await anomalyService.notifyPending();
        if (raised || sent) logger.info(`[audit] anomalies: ${raised} raised by rules, ${sent} notified`);
        return { raised, sent };
      }
      logger.debug(`[audit] job ${job.name} ignored`);
      return null;
    },
    { connection: redisConnection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => logger.error(`[audit] ${job?.name} failed: ${err.message}`));

  // Run both once at boot so the UI has a verification result straight away.
  void anomalyService
    .verifyChainScheduled()
    .then(() => anomalyService.detectRuleBreaches())
    .then(() => anomalyService.notifyPending())
    .catch((err) => logger.error(`[audit] boot check failed: ${(err as Error).message}`));

  logger.info("[audit] worker started: chain check every 30 min, anomaly rules every 2 min");
  return worker;
}
