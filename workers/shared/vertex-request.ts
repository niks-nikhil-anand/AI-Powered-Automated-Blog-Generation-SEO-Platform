import { QueueEvents } from "bullmq";
import { randomUUID } from "crypto";
import { createRedisConnection } from "./redis";
import { QUEUE_NAMES, vertexQueue } from "./queues";
import type { VertexTelemetryContext } from "./langfuse";
import { currentVertexTelemetryContext } from "./vertex-telemetry-context";

export type VertexPriority = "critical" | "deferrable";
export type VertexOperation = "text" | "json" | "vision-json" | "image" | "embedding";

export type VertexRequest = {
  operation: VertexOperation;
  model: string;
  prompt: string;
  priority: VertexPriority;
  timeoutMs?: number;
  temperature?: number;
  maxOutputTokens?: number;
  schema?: unknown;
  image?: { data: string; mimeType: string };
  aspectRatio?: string;
  negativePrompt?: string;
  /** Time the request entered vertex_queue, used to measure gateway queue wait. */
  enqueuedAt?: number;
  /** Non-sensitive request identity, consumed by the gateway's Langfuse trace. */
  telemetry?: VertexTelemetryContext;
  /** Structured terminal gateway outcome, written only by the gateway worker. */
  gatewayError?: {
    code: typeof VERTEX_CAPACITY_EXHAUSTED_CODE;
    model: string;
    attempts: number;
  };
};

export type VertexResponse = {
  text?: string;
  usage: { promptTokens: number; completionTokens: number };
  image?: { data: string; mimeType: string };
  embeddings?: number[][];
};

/** Stable marker that survives BullMQ's failed-job error serialization. */
export const VERTEX_CAPACITY_EXHAUSTED_CODE = "VERTEX_CAPACITY_EXHAUSTED";

/**
 * The gateway has exhausted its own retry budget for a Vertex quota error.
 * Pipeline workers use this typed error to stop BullMQ retrying an entire
 * stage, which would merely create more load against the same exhausted lane.
 */
export class VertexCapacityExhaustedError extends Error {
  readonly code = VERTEX_CAPACITY_EXHAUSTED_CODE;

  constructor(public readonly args: { model?: string; attempts?: number; cause?: unknown }) {
    super(`${VERTEX_CAPACITY_EXHAUSTED_CODE}: model=${args.model ?? "unknown"}; attempts=${args.attempts ?? "unknown"}`);
    this.name = "VertexCapacityExhaustedError";
  }
}

function isCapacityExhausted(error: unknown): boolean {
  return error instanceof Error && error.message.includes(VERTEX_CAPACITY_EXHAUSTED_CODE);
}

const events = new QueueEvents(QUEUE_NAMES.vertex, { connection: createRedisConnection() });

function priorityValue(priority: VertexPriority): number {
  return priority === "critical" ? 1 : 10;
}

/**
 * RPC facade for Vertex. This module deliberately has no Google SDK client:
 * workers enqueue a request and only vertex-gateway may execute it.
 */
export async function requestVertex(request: VertexRequest): Promise<VertexResponse> {
  const vertexJobId = `vertex-${randomUUID()}`;
  const job = await vertexQueue.add("vertex-request", {
    ...request,
    enqueuedAt: Date.now(),
    telemetry: {
      ...currentVertexTelemetryContext(),
      ...request.telemetry,
      requestId: randomUUID(),
    },
  }, {
    jobId: vertexJobId,
    priority: priorityValue(request.priority),
  });
  try {
    return await job.waitUntilFinished(events, request.timeoutMs ? request.timeoutMs + 10 * 60_000 : 15 * 60_000) as VertexResponse;
  } catch (error) {
    const failedJob = job.id ? await vertexQueue.getJob(job.id).catch(() => undefined) : undefined;
    const gatewayError = failedJob?.data.gatewayError;
    if (gatewayError?.code === VERTEX_CAPACITY_EXHAUSTED_CODE || isCapacityExhausted(error)) {
      throw new VertexCapacityExhaustedError({
        model: gatewayError?.model ?? request.model,
        attempts: gatewayError?.attempts,
        cause: error,
      });
    }
    throw error;
  }
}
