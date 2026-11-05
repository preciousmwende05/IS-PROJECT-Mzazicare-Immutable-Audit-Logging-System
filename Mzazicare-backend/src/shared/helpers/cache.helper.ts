import { redis } from "@/shared/config/redis";

const DEFAULT_TTL_SECONDS = 300;

/**
 * Read-through cache. Keys are namespaced `<module>:<thing>:<id>` so a module
 * can invalidate its own without touching anyone else's.
 */
export const cache = {
  get: async <T>(key: string): Promise<T | null> => {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  },

  set: async (key: string, value: unknown, ttlSeconds = DEFAULT_TTL_SECONDS) => {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  },

  remember: async <T>(key: string, ttlSeconds: number, produce: () => Promise<T>): Promise<T> => {
    const hit = await cache.get<T>(key);
    if (hit !== null) return hit;
    const value = await produce();
    await cache.set(key, value, ttlSeconds);
    return value;
  },

  forget: async (key: string) => {
    await redis.del(key);
  },

  /** Clears a whole namespace, e.g. invalidate("elder:*"). */
  invalidate: async (pattern: string): Promise<number> => {
    const keys = await redis.keys(pattern);
    if (!keys.length) return 0;
    await redis.del(...keys);
    return keys.length;
  },
};
