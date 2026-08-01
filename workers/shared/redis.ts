import IORedis from "ioredis";
import { env } from "./env";

/**
 * Shared Redis connection for BullMQ. `maxRetriesPerRequest: null` is
 * required by BullMQ (https://docs.bullmq.io/guide/connections) - without
 * it, blocking commands used internally by BullMQ workers will error out.
 */
export function createRedisConnection() {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

export const redis = createRedisConnection();

redis.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[redis] connection error:", err.message);
});
