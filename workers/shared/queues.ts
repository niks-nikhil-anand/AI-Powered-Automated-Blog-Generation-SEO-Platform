import { Queue } from "bullmq";
import { createRedisConnection } from "./redis";
import { currentJobAttempts } from "./retry-config";

/**
 * Queue names. The content pipeline proper is
 * planning -> outline -> writing -> image -> quality -> publish; a blog
 * enters it when a BlogInput is submitted at /dashboard/blogs/new.
 *
 * `scheduler` is not a content stage - it carries the cron-driven jobs
 * (the daily-target reconcile tick and the publish slots), which dispatch
 * PENDING BlogInput rows into `planning`. It replaced the research queue,
 * which used to own those schedulers.
 */
export const QUEUE_NAMES = {
  scheduler: "scheduler_queue",
  planning: "planning_queue",
  outline: "outline_queue",
  writing: "writing_queue",
  image: "image_queue",
  quality: "quality_queue",
  publish: "publish_queue",
  vertex: "vertex_queue",
} as const;

/**
 * `attempts` is a GETTER on purpose: BullMQ merges defaultJobOptions into
 * each job at add time, so every newly enqueued job reads the live value.
 * That makes the Settings page's Retry Attempts input
 * (AppSetting "retryAttempts" via workers/shared/retry-config.ts) the single
 * source of truth - total BullMQ attempts = configured retries + 1 (the
 * initial try). The cache behind currentJobAttempts() is refreshed per job
 * in startWorkerAttempt and whenever the settings API saves a new value, so
 * changing the setting takes effect for future runs with no worker restart
 * and no code change. Nothing in the pipeline may hard-code a retry count.
 */
const dynamicJobOptions = {
  get attempts() {
    return currentJobAttempts();
  },
  backoff: { type: "recovery" as const },
  removeOnComplete: { count: 5000 },
  removeOnFail: { count: 10000 },
};

export const schedulerQueue = new Queue(QUEUE_NAMES.scheduler, {
  connection: createRedisConnection(),
  defaultJobOptions: dynamicJobOptions,
});

export const planningQueue = new Queue(QUEUE_NAMES.planning, {
  connection: createRedisConnection(),
  defaultJobOptions: dynamicJobOptions,
});

export const outlineQueue = new Queue(QUEUE_NAMES.outline, {
  connection: createRedisConnection(),
  defaultJobOptions: dynamicJobOptions,
});

export const writingQueue = new Queue(QUEUE_NAMES.writing, {
  connection: createRedisConnection(),
  defaultJobOptions: dynamicJobOptions,
});

export const imageQueue = new Queue(QUEUE_NAMES.image, {
  connection: createRedisConnection(),
  defaultJobOptions: dynamicJobOptions,
});

export const qualityQueue = new Queue(QUEUE_NAMES.quality, {
  connection: createRedisConnection(),
  defaultJobOptions: dynamicJobOptions,
});

export const publishQueue = new Queue(QUEUE_NAMES.publish, {
  connection: createRedisConnection(),
  defaultJobOptions: dynamicJobOptions,
});

/** The only queue permitted to execute Vertex AI requests. */
export const vertexQueue = new Queue(QUEUE_NAMES.vertex, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 10000 },
  },
});

/**
 * Deterministic job IDs - the single source of truth for the pipeline's
 * duplicate-job guard (docs/FIX-PLAN-deterministic-job-ids.md).
 *
 * Two keying strategies, chosen per link so dedupe can never stall the
 * chain (BullMQ returns an existing job - even a COMPLETED one - without
 * re-running it, and completed jobs linger via removeOnComplete):
 *
 *  - ENTITY-keyed (plan/outline/write/publish): the stage runs once ever
 *    per BlogInput/blog. A retried upstream job that crashes after enqueueing
 *    re-adds the same ID and BullMQ dedupes it - no duplicate AI spend.
 *
 *  - EPOCH-keyed (writeQaRetry/image/quality/manual*): the stage
 *    legitimately re-runs (QA requeues, rewrites, re-scores, manual
 *    triggers), so the ID carries an epoch discriminator that is unique
 *    per logical run but stable within it. Entity-keying these would
 *    dedupe away legitimate re-runs and stall blogs in DRAFT.
 *
 * Accepted trade-off: epoch keys built from attempt IDs change across
 * BullMQ retries of the upstream job, so a crash-after-enqueue retry can
 * add one duplicate image/QA job. Both stages are idempotent (image
 * featuredImageId skip, QA report upsert), so the worst case is one
 * extra QA re-score - cheap versus a stalled pipeline.
 */
export const JOB_IDS = {
  /** input -> planning: one plan per submitted specification. */
  plan: (blogInputId: string) => `plan-${blogInputId}`,
  /** planning -> outline: one outline per submitted specification. */
  outline: (blogInputId: string) => `outline-${blogInputId}`,
  /** outline -> writing (fresh draft): one blog per submitted specification. */
  write: (blogInputId: string) => `write-${blogInputId}`,
  /**
   * quality -> writing (QA requeue): retry-stable - a retried quality job
   * recounts the same writingAttemptCount and dedupes against itself.
   */
  writeQaRetry: (blogInputId: string, writingAttemptCount: number) => `write-${blogInputId}-qa${writingAttemptCount}`,
  /** dashboard regenerate: double-click before the job runs dedupes on the same count. */
  writeManualRegen: (blogInputId: string, writingAttemptCount: number) => `write-${blogInputId}-regen${writingAttemptCount}`,
  /** writing -> image: epoch = the writing attempt that produced this draft. */
  image: (blogId: string, writingAttemptId: string) => `image-${blogId}-${writingAttemptId}`,
  /** image -> quality: epoch = the image-worker attempt. */
  quality: (blogId: string, imageAttemptId: string) => `quality-${blogId}-${imageAttemptId}`,
  /** dashboard "Re-run QA": every click is a legitimate new scoring run. */
  qualityManual: (blogId: string) => `quality-${blogId}-manual-${Date.now()}`,
  /** quality -> publish: one publish per blog, ever (idempotency key). */
  publish: (blogId: string) => `publish-${blogId}`,
  /** dashboard "Run pipeline": double-click within the same minute dedupes. */
  manualReconcile: () => `manual-reconcile-${Math.floor(Date.now() / 60_000)}`,
} as const;

export type PlanningJobPayload = {
  blogInputId: string;
  title: string;
  category: string;
  /** BlogInput.evidenceSummary - empty string when the input is unsourced. */
  evidenceSummary: string;
  evidenceSources?: unknown[];
};

export type OutlineJobPayload = {
  blogInputId: string;
  planId: string;
};

export type WritingJobPayload = {
  blogInputId: string;
  outlineId?: string;
  topic: string;
  description: string;
  recoveryContext?: {
    reason: string;
    qualityReport?: unknown;
    /**
     * Actionable fixes from quality-worker's LLM judge (Task 4), shape
     * mirrored from workers/quality-worker/judge.ts's JudgeFix (declared
     * inline to keep this file dependency-free). Consumed by the writing
     * worker's targeted-repair path (Task 5).
     */
    judgeFixes?: { section: string; issue: string; fix: string; priority: "high" | "medium" | "low" }[];
    /**
     * Failing claims from quality-worker's fact check (Task 6.1), shape
     * mirrored from workers/quality-worker/factcheck.ts's FullFactCheckClaim
     * (declared inline to keep this file dependency-free). These are the
     * concrete claim texts QA could not verify - the writing worker's
     * claim-repair path consumes them so a fact-check block no longer
     * triggers a blind full rewrite.
     */
    factCheckIssues?: { claim: string; verdict: string; note?: string }[];
  };
};

export type ImageJobPayload = {
  blogId: string;
  blogInputId?: string;
  title: string;
  slug: string;
  category: string;
  excerpt?: string;
};

export type QualityJobPayload = {
  blogId: string;
};

export type PublishJobPayload = {
  blogId: string;
  qualityReportId: string;
};
