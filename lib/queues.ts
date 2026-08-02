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
