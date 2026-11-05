import logger from "@/shared/config/logger";
import { on } from "@/shared/events/bus";
import { cache } from "@/shared/helpers/cache.helper";

/**
 * Shared handlers that belong to no single module.
 */
on("cache.invalidate", async ({ resource }) => {
  const cleared = await cache.invalidate(resource);
  logger.debug(`[cache] invalidated ${cleared} key(s) for ${resource}`);
});
