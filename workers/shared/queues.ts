import { Queue } from "bullmq";
import { createRedisConnection } from "./redis";

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
} as const;

export const researchQueue = new Queue(QUEUE_NAMES.research, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

export const planningQueue = new Queue(QUEUE_NAMES.planning, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

export const outlineQueue = new Queue(QUEUE_NAMES.outline, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

export const writingQueue = new Queue(QUEUE_NAMES.writing, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
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
};
