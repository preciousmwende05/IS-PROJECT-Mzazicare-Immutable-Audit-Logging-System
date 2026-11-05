import Redis from "ioredis";

import { env } from "@/shared/config/env";
import logger from "@/shared/config/logger";

/**
 * Shared Redis client for caching and presence. BullMQ gets its own
 * connection options from `@/shared/queues/connection` — do not reuse this
 * client for queues, BullMQ needs connections it fully controls.
 */
export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});

redis.on("error", (err) => logger.error(`[redis] ${err.message}`));
redis.on("connect", () => logger.info("[redis] connected"));
