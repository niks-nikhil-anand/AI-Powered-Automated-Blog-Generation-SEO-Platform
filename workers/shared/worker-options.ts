import type { WorkerOptions } from "bullmq";
import { createRedisConnection } from "./redis";

export function workerOptions(concurrency = 1): WorkerOptions {
  return {
    connection: createRedisConnection(),
    concurrency,
    lockDuration: 5 * 60 * 1000,
    lockRenewTime: 60 * 1000,
    stalledInterval: 60 * 1000,
    maxStalledCount: 2,
    settings: {
      backoffStrategy: (attemptsMade, type) => {
        if (type !== "recovery") return 30000;
        if (attemptsMade <= 1) return 0;
        if (attemptsMade === 2) return 30000;
        return 60000;
      },
    },
  };
}
