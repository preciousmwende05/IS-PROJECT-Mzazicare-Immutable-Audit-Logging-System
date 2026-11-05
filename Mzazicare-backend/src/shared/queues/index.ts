import { Queue } from "bullmq";

import { redisConnection } from "@/shared/queues/connection";

/**
 * Background work queues. A module publishes a job here and its worker
 * (`modules/<x>-service/consumers/*.worker.ts`) drains it.
 *
 * Use a queue when the work is slow, external, or may need retrying.
 * Use the event bus when you are announcing a fact.
 */
const defaults = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export const notificationsQueue = new Queue("notifications", {
  connection: redisConnection,
  defaultJobOptions: defaults,
});

export const smsQueue = new Queue("sms", {
  connection: redisConnection,
  defaultJobOptions: { ...defaults, attempts: 5, backoff: { type: "exponential", delay: 3000 } },
});

export const emailQueue = new Queue("email", {
  connection: redisConnection,
  defaultJobOptions: { ...defaults, attempts: 5, backoff: { type: "exponential", delay: 5000 } },
});

export const paymentQueue = new Queue("payment", {
  connection: redisConnection,
  defaultJobOptions: { ...defaults, attempts: 5 },
});

export const emergencyQueue = new Queue("emergency", {
  connection: redisConnection,
  // An escalation that is retried too slowly is useless — fail fast and loud.
  defaultJobOptions: { ...defaults, attempts: 3, backoff: { type: "fixed", delay: 5000 } },
});

/**
 * booking-service (U-CS 71) drains this: caregiver matching, the offer-expiry
 * sweep, and recurrence generation. `attempts: 3` because a match that fails
 * on a transient error is worth retrying — the matcher is idempotent, it
 * re-reads the booking's status every run.
 */
export const bookingQueue = new Queue("booking", {
  connection: redisConnection,
  defaultJobOptions: defaults,
});

export const visitQueue = new Queue("visit", {
  connection: redisConnection,
  defaultJobOptions: defaults,
});

export const auditQueue = new Queue("audit", {
  connection: redisConnection,
  // Compliance records are never dropped on the floor.
  defaultJobOptions: {
    attempts: 10,
    backoff: { type: "exponential", delay: 2000 },
    removeOnFail: false,
  },
});
