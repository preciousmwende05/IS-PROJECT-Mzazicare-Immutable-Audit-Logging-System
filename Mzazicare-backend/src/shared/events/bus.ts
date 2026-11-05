import { Queue, Worker, type Job } from "bullmq";

import logger from "@/shared/config/logger";
import { redisConnection } from "@/shared/queues/connection";
import type { DomainEvent, EventType, EventPayload } from "@/shared/events/types";

export type EventMeta = { eventId: string; publishedAt: Date };

type Handler<T extends EventType> = (payload: EventPayload<T>, meta: EventMeta) => Promise<void>;

/**
 * Handlers are stored erased, because the registry holds many different
 * payload types in one map. The `on()` and `publish()` signatures are what
 * keep callers honest — the casts below never escape this file.
 */
type ErasedHandler = (payload: DomainEvent, meta: EventMeta) => Promise<void>;

const registry = new Map<EventType, ErasedHandler[]>();

const queue = new Queue("domain-events", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

/**
 * Subscribe. Called at module load time from
 * `modules/<x>-service/consumers/<x>.handlers.ts`, which src/server.ts imports.
 *
 *   on("booking.confirmed", async ({ bookingId, caregiverId }) => { ... });
 */
export function on<T extends EventType>(event: T, handler: Handler<T>) {
  if (!registry.has(event)) registry.set(event, []);
  registry.get(event)!.push(handler as unknown as ErasedHandler);
}

/**
 * Publish a fact about your own domain. The caller does not wait for
 * subscribers and does not fail if one throws — that is the point of the seam.
 *
 *   await publish("booking.confirmed", { bookingId, caregiverId });
 */
export async function publish<T extends EventType>(
  event: T,
  payload: Omit<EventPayload<T>, "type">,
) {
  await queue.add(event, { type: event, ...payload } as unknown as DomainEvent);
}

export function startEventWorker() {
  const worker = new Worker<DomainEvent>(
    "domain-events",
    async (job: Job<DomainEvent>) => {
      const handlers = registry.get(job.data.type) ?? [];
      const meta: EventMeta = { eventId: String(job.id), publishedAt: new Date(job.timestamp) };
      // Handlers run in parallel. One failing retries the whole job, so every
      // handler must be idempotent.
      await Promise.all(handlers.map((handle) => handle(job.data, meta)));
    },
    { connection: redisConnection, concurrency: 20 },
  );

  worker.on("failed", (job, err) => {
    logger.error(`[event-bus] ${job?.name} failed: ${err.message}`);
  });

  logger.info("[event-bus] worker started");
  return worker;
}
