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
        // Vertex RPM quota windows are 60s+; sub-minute whole-job retries
        // land inside the still-saturated window and just burn another
        // full-draft attempt (docs/VERTEX_429_RESILIENCE_PLAN.md Task 8).
        // Call-level retry (Task 7) covers sub-minute transients, so a job
        // that still needs a retry should wait out the window.
        if (attemptsMade <= 1) return 60000;
        if (attemptsMade === 2) return 180000;
        return 300000;
      },
    },
  };
}
