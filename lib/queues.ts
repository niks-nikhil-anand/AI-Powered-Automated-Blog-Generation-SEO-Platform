/**
 * Shared queue-inspection helpers for the API routes.
 *
 * Both /api/dashboard and /api/pipeline/run-context need per-queue job counts,
 * so the implementation lives here rather than being duplicated.
 */
import {
  imageQueue,
  outlineQueue,
  planningQueue,
  publishQueue,
  qualityQueue,
  researchQueue,
  writingQueue,
  QUEUE_NAMES,
} from "@/workers/shared/queues";

export type QueueCounts = {
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
  completed: number;
};

export type StageKey =
  | "research"
  | "planning"
  | "outline"
  | "writing"
  | "image"
  | "quality"
  | "publish";

export const STAGE_QUEUES = {
  research: researchQueue,
  planning: planningQueue,
  outline: outlineQueue,
  writing: writingQueue,
  image: imageQueue,
  quality: qualityQueue,
  publish: publishQueue,
} as const;

export const STAGE_ORDER: StageKey[] = [
  "research",
  "planning",
  "outline",
  "writing",
  "image",
  "quality",
  "publish",
];

/** Queue instances keyed by BullMQ queue name (e.g. "writing_queue") - used by /api/workers/actions. */
export const QUEUE_BY_NAME: Record<string, (typeof STAGE_QUEUES)[StageKey]> =
  Object.fromEntries(
    STAGE_ORDER.map((stage) => [QUEUE_NAMES[stage], STAGE_QUEUES[stage]])
  );

export async function queueCounts(queue: typeof researchQueue): Promise<QueueCounts> {
  const counts = await queue.getJobCounts("active", "waiting", "delayed", "failed", "completed");
  return {
    active: counts.active ?? 0,
    waiting: counts.waiting ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
  };
}

/** Counts for all seven stages, fetched in parallel. */
export async function allQueueCounts(): Promise<Record<StageKey, QueueCounts>> {
  const entries = await Promise.all(
    STAGE_ORDER.map(async (stage) => [stage, await queueCounts(STAGE_QUEUES[stage])] as const)
  );
  return Object.fromEntries(entries) as Record<StageKey, QueueCounts>;
}

// ---------------------------------------------------------------------
// Worker health / ops helpers (docs/workers-page-uiux-plan.md)
// ---------------------------------------------------------------------

export type QueueHealth = {
  /** Live BullMQ worker processes currently consuming this queue (0 = unmanned). */
  consumers: number;
  paused: boolean;
};

/**
 * Liveness + pause state for one queue. `getWorkers()` is BullMQ's registry
 * of connected consumers (parsed from Redis CLIENT LIST) - a count of 0
 * means no process is consuming that queue right now, which is the honest
 * core of "worker health" and needs no heartbeat code in the workers.
 */
export async function queueHealth(queue: typeof researchQueue): Promise<QueueHealth> {
  const [workers, paused] = await Promise.all([queue.getWorkers(), queue.isPaused()]);
  return { consumers: workers.length, paused };
}

export type QueueMetrics = {
  completedLast15m: number;
  failedLast15m: number;
};

/**
 * Throughput over the last 15 one-minute buckets. BullMQ OSS metrics store
 * per-minute *counts* only (no durations), so duration stats (avg/p95) are
 * computed from WorkerAttempt rows in /api/dashboard instead of here.
 */
export async function queueMetrics(queue: typeof researchQueue): Promise<QueueMetrics> {
  const [completed, failed] = await Promise.all([
    queue.getMetrics("completed", 0, 14).catch(() => null),
    queue.getMetrics("failed", 0, 14).catch(() => null),
  ]);
  const sum = (metrics: { data: number[] } | null) =>
    metrics ? metrics.data.reduce((total, n) => total + n, 0) : 0;
  return { completedLast15m: sum(completed), failedLast15m: sum(failed) };
}

export type FailedJobSnapshot = {
  id: string;
  queue: string;
  name: string;
  payload: string;
  attemptsMade: number;
  failedReason: string;
  stacktrace: string[];
  durationMs: number | null;
  failedAt: string | null;
};

/**
 * Recently-failed BullMQ jobs across all seven queues (newest first). These
 * are the rows the job inspector can actually retry - unlike DB audit rows,
 * a failed BullMQ job accepts `job.retry()`.
 */
export async function recentFailedJobs(perQueue = 5, total = 10): Promise<FailedJobSnapshot[]> {
  const perQueueJobs = await Promise.all(
    STAGE_ORDER.map(async (stage) => {
      const queue = STAGE_QUEUES[stage];
      const jobs = await queue.getJobs(["failed"], 0, perQueue - 1);
      return jobs.map((job) => ({
        id: String(job.id),
        queue: queue.name,
        name: job.name,
        payload: JSON.stringify(job.data ?? {}).slice(0, 160),
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason ?? "",
        stacktrace: Array.isArray(job.stacktrace) ? job.stacktrace : [],
        durationMs:
          job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
        failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      }));
    })
  );
  return perQueueJobs
    .flat()
    .sort((a, b) => (b.failedAt ?? "").localeCompare(a.failedAt ?? ""))
    .slice(0, total);
}
