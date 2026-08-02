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
  };
}
