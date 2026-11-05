/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { Queue } from "bullmq";

import { redisConnection } from "@/shared/queues/connection";
import type { Priority } from "@/modules/notification-service/models/notification.model";

export const DELIVERY_QUEUE = "notification-delivery";
export const DELIVERY_ATTEMPTS = 3;

export const deliveryQueue = new Queue<{ attemptId: string }>(DELIVERY_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: DELIVERY_ATTEMPTS,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

// no BullMQ priority: prioritised jobs run after unprioritised ones
export const enqueueDelivery = (attemptId: string, priority: Priority, delayMs: number) =>
  deliveryQueue.add(
    "deliver",
    { attemptId },
    {
      jobId: attemptId,
      delay: delayMs,
      ...(priority === "critical" ? { backoff: { type: "fixed", delay: 3000 } } : {}),
    },
  );
