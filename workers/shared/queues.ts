import { Queue } from "bullmq";
import { createRedisConnection } from "./redis";
import { currentJobAttempts } from "./retry-config";

/**
 * Queue names. Matches the naming convention in README.md's "Queue
 * Architecture" section. Only `research` and `writing` are implemented so
 * far (MVP scope) - `planning`, `outline`, `image`, `quality`, and
 * `publish` are reserved names for the remaining workers described in the
 * README roadmap (Phase 3/4).
 */
export const QUEUE_NAMES = {
  research: "research_queue",
  planning: "planning_queue",
  outline: "outline_queue",
  writing: "writing_queue",
  image: "image_queue",
  quality: "quality_queue",
  publish: "publish_queue",
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

export const researchQueue = new Queue(QUEUE_NAMES.research, {
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

export type PlanningJobPayload = {
  trendId: string;
  topic: string;
  category: string;
  score: number;
  evidenceSummary: string;
};

export type OutlineJobPayload = {
  trendId: string;
  planId: string;
};

export type WritingJobPayload = {
  trendId: string;
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
  trendId?: string;
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
