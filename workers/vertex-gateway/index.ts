import { GoogleGenAI, type GenerateContentConfig, type SchemaUnion } from "@google/genai";
import { Job, Worker } from "bullmq";
import { env, isVertexGatewayConfigured } from "../shared/env";
import { logger } from "../shared/logger";
import { QUEUE_NAMES } from "../shared/queues";
import { acquireModelSlot, modelClassOf, resetBreaker, tripBreaker, waitForBreakerProbe } from "../shared/rate-limit";
import { VertexCapacityExhaustedError, type VertexRequest, type VertexResponse } from "../shared/vertex-request";
import { workerOptions } from "../shared/worker-options";
import { initializeLangfuse, shutdownLangfuse, traceGatewayRequest, traceVertexInvocation } from "./langfuse";

const log = logger.child({ worker: "vertex-gateway" });

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function errorInfo(error: unknown): { code?: number; status?: string } {
  if (!error || typeof error !== "object") return {};
  const value = error as Record<string, unknown>;
  const nested = (value.error ?? {}) as Record<string, unknown>;
  return {
    code: typeof value.code === "number" ? value.code : typeof nested.code === "number" ? nested.code as number : undefined,
    status: typeof value.status === "string" ? value.status : typeof nested.status === "string" ? nested.status as string : undefined,
  };
}
function retryable(error: unknown) {
  const { code, status } = errorInfo(error);
  return code === 429 || code === 500 || code === 503 || status === "RESOURCE_EXHAUSTED" || status === "UNAVAILABLE" || status === "INTERNAL";
}
function retryDelayMs(error: unknown): number | undefined {
  // Google RPC RetryInfo is represented differently by SDK versions. Walk a
  // small, cycle-safe object graph and accept both protobuf duration strings
  // ("12.5s") and numeric millisecond fields.
  const visited = new Set<unknown>();
  const walk = (value: unknown, depth = 0): number | undefined => {
    if (!value || typeof value !== "object" || depth > 5 || visited.has(value)) return undefined;
    visited.add(value);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase();
      if (normalized === "retryafterms" || normalized === "retrydelayms") {
        const ms = Number(child);
        if (Number.isFinite(ms) && ms >= 0) return ms;
      }
      if (normalized === "retryafter" || normalized === "retrydelay") {
        if (typeof child === "number" && Number.isFinite(child) && child >= 0) return child * 1000;
        if (typeof child === "string") {
          const match = child.match(/^(\d+(?:\.\d+)?)s$/i);
          if (match) return Math.round(Number(match[1]) * 1000);
        }
        if (child && typeof child === "object") {
          const duration = child as Record<string, unknown>;
          const seconds = Number(duration.seconds ?? 0);
          const nanos = Number(duration.nanos ?? 0);
          if (Number.isFinite(seconds) && Number.isFinite(nanos) && (seconds > 0 || nanos > 0)) return Math.round(seconds * 1000 + nanos / 1_000_000);
        }
      }
      const nested = walk(child, depth + 1);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return walk(error);
}
function backoffWithJitter(attempt: number): number {
  const cap = Math.min(env.VERTEX_RETRY_MAX_MS, env.VERTEX_RETRY_BASE_MS * 2 ** (attempt - 1));
  // Full jitter prevents a fleet of workers from retrying on the same edge.
  return Math.max(1, Math.floor(Math.random() * (cap + 1)));
}
function usage(result: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }) {
  return { promptTokens: result.usageMetadata?.promptTokenCount ?? 0, completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0 };
}

function client() {
  if (!isVertexGatewayConfigured) throw new Error("Vertex gateway is not configured with Google credentials");
  return new GoogleGenAI({ vertexai: true, project: env.GOOGLE_CLOUD_PROJECT, location: env.VERTEX_LOCATION });
}

async function execute(request: VertexRequest): Promise<VertexResponse> {
  const ai = client();
  const config: GenerateContentConfig = {
    ...(request.operation === "json" || request.operation === "vision-json" ? { responseMimeType: "application/json" } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
    ...(request.schema ? { responseSchema: request.schema as SchemaUnion } : {}),
  };
  if (request.operation === "embedding") {
    const result = await ai.models.embedContent({ model: request.model, contents: request.prompt });
    return { usage: { promptTokens: Math.max(1, Math.ceil(request.prompt.length / 4)), completionTokens: 0 }, embeddings: result.embeddings?.map((entry) => entry.values ?? []) ?? [] };
  }
  if (request.operation === "image") {
    const result = await ai.models.generateContent({ model: request.model, contents: request.negativePrompt ? `${request.prompt}\n\nAvoid: ${request.negativePrompt}.` : request.prompt, config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: request.aspectRatio ?? "16:9", outputMimeType: "image/jpeg" } } });
    const part = result.candidates?.[0]?.content?.parts?.find((candidate) => candidate.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("Vertex returned no image bytes");
    return { usage: usage(result), image: { data: part.inlineData.data, mimeType: part.inlineData.mimeType ?? "image/jpeg" } };
  }
  const contents = request.operation === "vision-json" && request.image
    ? [{ role: "user", parts: [{ text: request.prompt }, { inlineData: request.image }] }]
    : request.prompt;
  const result = await ai.models.generateContent({ model: request.model, contents, config });
  return { text: result.text ?? undefined, usage: usage(result) };
}

async function processRequest(request: VertexRequest): Promise<VertexResponse> {
  let lastError: unknown;
  let sawQuotaExhaustion = false;
  const modelClass = modelClassOf(request.model);
  const startedAt = Date.now();
  const probe = await waitForBreakerProbe(modelClass);
  if (probe) {
    log.info("Vertex breaker half-open; sending one probe", { model: request.model, modelClass });
  }
  for (let attempt = 1; attempt <= env.VERTEX_RETRY_MAX_ATTEMPTS; attempt += 1) {
    await acquireModelSlot(modelClassOf(request.model));
    try {
      const response = await traceVertexInvocation({
        request,
        modelClass,
        attempt,
        probe,
        work: () => execute(request),
      });
      await resetBreaker(modelClass);
      return response;
    } catch (error) {
      lastError = error;
      const info = errorInfo(error);
      sawQuotaExhaustion ||= info.code === 429 || info.status === "RESOURCE_EXHAUSTED";
      // A half-open probe gets one request only. If it still receives 429,
      // reopen immediately with an increased cooldown rather than spending a
      // second full retry budget against the overloaded model.
      if (probe && sawQuotaExhaustion) break;
      if (!retryable(error) || attempt === env.VERTEX_RETRY_MAX_ATTEMPTS) break;
      const serverWaitMs = retryDelayMs(error);
      const waitMs = Math.min(env.VERTEX_RETRY_MAX_MS, serverWaitMs ?? backoffWithJitter(attempt));
      if (Date.now() - startedAt + waitMs > env.VERTEX_RETRY_BUDGET_MS) break;
      log.warn("Vertex request failed; gateway will retry", { model: request.model, modelClass, operation: request.operation, priority: request.priority, attempt, waitMs, retryDelaySource: serverWaitMs === undefined ? "jittered-backoff" : "server", ...errorInfo(error) });
      await sleep(waitMs);
    }
  }
  if (lastError && sawQuotaExhaustion) {
    await tripBreaker(modelClass);
    throw new VertexCapacityExhaustedError({ model: request.model, attempts: env.VERTEX_RETRY_MAX_ATTEMPTS, cause: lastError });
  }
  throw lastError;
}

async function processGatewayJob(job: Job<VertexRequest>): Promise<VertexResponse> {
  try {
    return await traceGatewayRequest({ request: job.data, work: () => processRequest(job.data) });
  } catch (error) {
    if (error instanceof VertexCapacityExhaustedError) {
      await job.updateData({
        ...job.data,
        gatewayError: {
          code: error.code,
          model: error.args.model ?? job.data.model,
          attempts: error.args.attempts ?? env.VERTEX_RETRY_MAX_ATTEMPTS,
        },
      });
    }
    throw error;
  }
}

export function startVertexGateway() {
  initializeLangfuse();
  const worker = new Worker<VertexRequest, VertexResponse>(
    QUEUE_NAMES.vertex,
    processGatewayJob,
    { ...workerOptions(1), concurrency: 1 }
  );
  worker.on("completed", (job) => log.info("Vertex request completed", { requestId: job.id, operation: job.data.operation, model: job.data.model }));
  worker.on("failed", (job, error) => log.error("Vertex request failed", { requestId: job?.id, operation: job?.data.operation, model: job?.data.model, error: error.message, ...errorInfo(error) }));
  log.info("Vertex gateway listening", { queue: QUEUE_NAMES.vertex, flashRpm: env.VERTEX_FLASH_RPM, concurrency: 1 });
  return worker;
}

if (require.main === module) {
  const worker = startVertexGateway();
  const shutdown = async () => {
    await worker.close();
    await shutdownLangfuse();
    process.exit(0);
  };
  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT", () => { void shutdown(); });
}
