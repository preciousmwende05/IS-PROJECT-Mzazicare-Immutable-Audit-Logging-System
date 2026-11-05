/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { Worker, type Job } from "bullmq";

import logger from "@/shared/config/logger";
import { redisConnection } from "@/shared/queues/connection";
import { smsService } from "@/shared/services/sms.service";
import { intakeService } from "@/modules/notification-service/services/intake.service";
import { DELIVERY_QUEUE } from "@/modules/notification-service/services/notification.queues";
import { notificationService } from "@/modules/notification-service/services/notification.service";

export function startNotificationWorker() {
  const intake = new Worker("notifications", (job: Job) => intakeService.handle(job), {
    connection: redisConnection,
    concurrency: 5,
  });
  intake.on("failed", (job, err) =>
    logger.error(`[notification] intake ${job?.name} (job ${job?.id}) failed: ${err.message}`),
  );

  const delivery = new Worker<{ attemptId: string }>(
    DELIVERY_QUEUE,
    (job) => notificationService.deliver(job.data.attemptId),
    { connection: redisConnection, concurrency: 10 },
  );
  delivery.on("failed", (job, err) => {
    if (!job) return;
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!exhausted) {
      logger.warn(
        `[notification] delivery ${job.data.attemptId} attempt ${job.attemptsMade} failed: ${err.message}`,
      );
      return;
    }
    logger.error(
      `[notification] delivery ${job.data.attemptId} dead after ${job.attemptsMade} attempts: ${err.message}`,
    );
    notificationService
      .markDead(job.data.attemptId, err.message)
      .catch((e: unknown) =>
        logger.error(
          `[notification] could not dead-letter ${job.data.attemptId}: ${(e as Error).message}`,
        ),
      );
  });

  const sms = new Worker<{ to: string; body: string }>(
    "sms",
    async (job) => {
      await smsService.send({ to: job.data.to, body: job.data.body });
    },
    { connection: redisConnection, concurrency: 5 },
  );
  sms.on("failed", (job, err) =>
    logger.error(`[notification] sms ${job?.name} (job ${job?.id}) failed: ${err.message}`),
  );

  logger.info("[notification] workers started: intake, delivery, sms");
  return { intake, delivery, sms };
}
