import { env } from "@/shared/config/env";

/** BullMQ builds its own connections from these options. */
export const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
};
