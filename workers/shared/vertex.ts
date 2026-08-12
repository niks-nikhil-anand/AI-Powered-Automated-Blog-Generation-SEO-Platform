import { GoogleGenAI, type GenerateContentConfig, type SchemaUnion } from "@google/genai";
import { env, isVertexConfigured } from "./env";
import { logger } from "./logger";
import { acquireModelSlot, isBreakerOpen, modelClassOf, tripBreaker } from "./rate-limit";

const log = logger.child({ worker: "vertex" });

/**
 * Boot fingerprint (docs/VERTEX_429_RESOLUTION_PLAN.md Step 1.2) - every
 * worker logs this at startup so `docker compose logs <worker>` proves at
 * a glance whether the container is running the resilience build.
 */
export function logVertexRuntimeConfig(childLog: { info: (message: string, meta?: object) => void }): void {
  childLog.info("Vertex resilience config", {
    retryAttempts: env.VERTEX_RETRY_MAX_ATTEMPTS,
    retryBaseMs: env.VERTEX_RETRY_BASE_MS,
    retryBudgetMs: env.VERTEX_RETRY_BUDGET_MS,
    maxConcurrent: env.VERTEX_MAX_CONCURRENT_CALLS,
    flashRpm: env.VERTEX_FLASH_RPM,
    proRpm: env.VERTEX_PRO_RPM,
    imageRpm: env.VERTEX_IMAGE_RPM,
    breakerCooldownMs: env.VERTEX_BREAKER_COOLDOWN_MS,
    modelFallback: env.VERTEX_MODEL_FALLBACK_ENABLED,
  });
}

export type VertexJsonResult<T> = {
  data: T;
  usage: { promptTokens: number; completionTokens: number };
};

export type VertexTextResult = {
  text: string;
  usage: { promptTokens: number; completionTokens: number };
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function extractJson<T>(text: string, fallback?: T): T {
  try {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fenced ? fenced[1] : trimmed;
    return JSON.parse(candidate.trim()) as T;
  } catch (error) {
    if (fallback !== undefined) {
      console.warn(`Failed to parse JSON from Vertex response, using fallback: ${error}`);
      return fallback;
    }
    throw new Error(`Failed to parse JSON from Vertex response: ${error}`);
  }
}

export type VertexJsonOptions = {
  schema?: SchemaUnion;
  maxOutputTokens?: number;
  temperature?: number;
  /** Overrides withVertexTimeout's 30s default - e.g. research-worker's semantic pass uses a longer one for large batches. */
  timeoutMs?: number;
  /** "deferrable" fails fast while the quota circuit breaker is open (declared below, used by withVertexRetry). */
  priority?: "critical" | "deferrable";
};

/**
 * Wrap a Vertex API call with a 30-second timeout to prevent indefinite hangs.
 * If API stalls, worker will fail fast and be retried instead of blocking forever.
 */
function withVertexTimeout<T>(promise: Promise<T>, timeoutMs: number = 30000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Vertex API timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/* ------------------------------------------------------------------------ */
/* 429/quota resilience (docs/VERTEX_429_RESILIENCE_PLAN.md Tasks 7/9/11)    */
/* ------------------------------------------------------------------------ */

/**
 * Typed error for persistent quota exhaustion (Task 11) - lets worker logs
 * distinguish "quota ran out" from content/parse failures at a glance, and
 * lets the writing worker's Pro->Flash fallback (Task 10) key off a type
 * instead of string-matching error messages.
 */
export class VertexQuotaError extends Error {
  readonly model: string;
  readonly status: string;
  readonly attempts: number;
  readonly cause?: unknown;

  constructor(args: { model: string; status: string; attempts: number; cause?: unknown }) {
    super(`Vertex quota exhausted for model "${args.model}" after ${args.attempts} attempt(s): ${args.status}`);
    this.name = "VertexQuotaError";
    this.model = args.model;
    this.status = args.status;
    this.attempts = args.attempts;
    this.cause = args.cause;
  }
}

type VertexErrorInfo = { code?: number; status?: string; retryAfterMs?: number };

/**
 * Tolerant extractor for @google/genai / google-rpc error shapes - the SDK
 * surfaces { code, message, status } at the top level, some transports nest
 * them under .error, and quota responses may carry a google-rpc RetryInfo
 * in details[] with retryDelay "30s".
 */
function vertexErrorInfo(error: unknown): VertexErrorInfo {
  if (!error || typeof error !== "object") return {};
  const err = error as Record<string, unknown>;
  const nested = (err.error ?? {}) as Record<string, unknown>;
  const code = typeof err.code === "number" ? err.code : typeof nested.code === "number" ? (nested.code as number) : undefined;
  const status =
    typeof err.status === "string" ? err.status : typeof nested.status === "string" ? (nested.status as string) : undefined;

  const details = [
    ...(Array.isArray(err.details) ? (err.details as unknown[]) : []),
    ...(Array.isArray(nested.details) ? (nested.details as unknown[]) : []),
  ];
  let retryAfterMs: number | undefined;
  for (const detail of details) {
    const delay = (detail as Record<string, unknown>)?.retryDelay;
    if (typeof delay !== "string") continue;
    const match = delay.match(/^(\d+(?:\.\d+)?)s$/);
    if (match) {
      retryAfterMs = Math.round(Number.parseFloat(match[1]) * 1000);
      break;
    }
  }
  return { code, status, retryAfterMs };
}

function isLocalTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Vertex API timeout");
}

function isQuotaError(error: unknown): boolean {
  const { code, status } = vertexErrorInfo(error);
  return code === 429 || status === "RESOURCE_EXHAUSTED";
}

/**
 * Retryable: quota contention (429), transient server-side (500/503), and
 * local client timeouts - all self-healing conditions. Non-retryable:
 * 400/401/403/404-style failures (bad prompt, auth, unknown model) where
 * retrying only burns time and job attempts.
 */
function isRetryableVertexError(error: unknown): boolean {
  if (isLocalTimeout(error)) return true;
  const { code, status } = vertexErrorInfo(error);
  if (code === 429 || code === 500 || code === 503) return true;
  return status === "RESOURCE_EXHAUSTED" || status === "INTERNAL" || status === "UNAVAILABLE";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter; honors a google-rpc RetryInfo hint when
 * present (still jittered so parallel retrying calls don't wake at the
 * same instant).
 */
function retryWaitMs(error: unknown, attempt: number): number {
  const jitter = Math.floor(Math.random() * env.VERTEX_RETRY_BASE_MS);
  const { retryAfterMs } = vertexErrorInfo(error);
  if (retryAfterMs !== undefined) {
    return Math.min(env.VERTEX_RETRY_MAX_MS, retryAfterMs + jitter);
  }
  return Math.min(env.VERTEX_RETRY_MAX_MS, env.VERTEX_RETRY_BASE_MS * 2 ** (attempt - 1)) + jitter;
}

/**
 * Task 9: deterministic per-batch start offset for parallel fan-outs
 * (semantic scoring, fact-check/self-check verify batches) so N batches
 * don't all hit the quota window at the same millisecond.
 */
export function batchStagger(index: number): Promise<void> {
  return sleep(index * 250 + Math.floor(Math.random() * 250));
}

/**
 * In-process concurrency cap over ALL generate* calls (Task 9). Every
 * worker runs in one process (npm run worker:dev / the worker container),
 * so one module-level semaphore covers research/writing/quality/image
 * simultaneously - the actual quota contention point.
 */
class Semaphore {
  private available: number;
  private readonly queue: (() => void)[] = [];

  constructor(slots: number) {
    this.available = Math.max(1, slots);
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.available += 1;
  }
}

const vertexCallSemaphore = new Semaphore(env.VERTEX_MAX_CONCURRENT_CALLS);

/**
 * "deferrable" = enrichment work whose fail-soft contract (heuristic
 * scores, null dimension, procedural SVG) absorbs a skip; it fails fast
 * WITHOUT an API call while the quota breaker is open. "critical" (the
 * default) = the publish path - always paced and retried normally.
 * See docs/VERTEX_429_RESOLUTION_PLAN.md Step 5.
 */
export type VertexCallPriority = "critical" | "deferrable";

/**
 * Task 7: retry a Vertex call on transient/quota failures with
 * backoff+jitter INSIDE the call - a self-healing 429 then never reaches
 * the BullMQ job layer, whose whole-job retries re-run entire drafts and
 * amplify quota burn. Layered on top (v2 plan):
 *  - every attempt first holds a Redis-paced, per-model-class RPM permit
 *    (Step 3 - coordinates the separate worker CONTAINERS, which the
 *    in-process semaphore cannot), then the local semaphore;
 *  - total retry wall-clock is capped by VERTEX_RETRY_BUDGET_MS (Step 4),
 *    so retry-stacking can't pin a job past BullMQ's lock semantics;
 *  - a call that exhausts all retries on quota TRIPS the circuit breaker
 *    (Step 5); while it's open, "deferrable" calls throw VertexQuotaError
 *    immediately without touching the API.
 * The semaphore slot is acquired per attempt and released before the
 * backoff sleep, so a waiting call doesn't starve others. Non-retryable
 * errors throw immediately.
 */
export async function withVertexRetry<T>(
  fn: () => Promise<T>,
  context: { model: string; priority?: VertexCallPriority }
): Promise<T> {
  const priority = context.priority ?? "critical";
  if (priority === "deferrable" && (await isBreakerOpen())) {
    throw new VertexQuotaError({
      model: context.model,
      status: "RESOURCE_EXHAUSTED (circuit breaker open)",
      attempts: 0,
    });
  }

  const maxAttempts = Math.max(1, env.VERTEX_RETRY_MAX_ATTEMPTS);
  const startedAt = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1 && Date.now() - startedAt > env.VERTEX_RETRY_BUDGET_MS) {
      log.warn("Vertex retry budget exhausted, stopping retries", {
        model: context.model,
        attempt,
        budgetMs: env.VERTEX_RETRY_BUDGET_MS,
      });
      break;
    }
    // Cross-container pacing first (may wait out a quota window), then the
    // local concurrency cap. Permit-first ordering means a call queued at
    // the semaphore never holds a window permit it can't use in time.
    await acquireModelSlot(modelClassOf(context.model));
    await vertexCallSemaphore.acquire();
    let failure: unknown = null;
    try {
      return await fn();
    } catch (error) {
      failure = error;
    } finally {
      vertexCallSemaphore.release();
    }
    lastError = failure;
    if (!isRetryableVertexError(failure) || attempt === maxAttempts) break;
    const waitMs = retryWaitMs(failure, attempt);
    const info = vertexErrorInfo(failure);
    log.warn("Vertex call failed with a retryable error, backing off", {
      model: context.model,
      attempt,
      maxAttempts,
      waitMs,
      code: info.code,
      status: info.status ?? (isLocalTimeout(failure) ? "LOCAL_TIMEOUT" : undefined),
    });
    await sleep(waitMs);
  }

  if (isQuotaError(lastError)) {
    // Genuine exhaustion after full retries - open the breaker so
    // deferrable load sheds immediately instead of hammering the pool.
    await tripBreaker();
    const info = vertexErrorInfo(lastError);
    throw new VertexQuotaError({
      model: context.model,
      status: info.status ?? "RESOURCE_EXHAUSTED",
      attempts: maxAttempts,
      cause: lastError,
    });
  }
  throw lastError;
}

export async function generateVertexJson<T>(
  modelName: string,
  prompt: string,
  options: VertexJsonOptions = {}
): Promise<VertexJsonResult<T>> {
  if (!isVertexConfigured) {
    throw new Error("Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT and VERTEX_LOCATION.");
  }

  const ai = new GoogleGenAI({
    vertexai: true,
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.VERTEX_LOCATION,
  });
  const config: GenerateContentConfig = {
    responseMimeType: "application/json",
    temperature: options.temperature ?? 0.4,
    ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.schema ? { responseSchema: options.schema } : {}),
  };

  const result = await withVertexRetry(
    () =>
      withVertexTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config,
        }),
        options.timeoutMs
      ),
    { model: modelName, priority: options.priority }
  );

  const text = result.text;
  if (!text) throw new Error("Gemini returned no text in response");

  return {
    data: extractJson<T>(text),
    usage: {
      promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

function vertexClient() {
  if (!isVertexConfigured) {
    throw new Error("Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT and VERTEX_LOCATION.");
  }
  return new GoogleGenAI({
    vertexai: true,
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.VERTEX_LOCATION,
  });
}

export type VertexImageResult = {
  buffer: Buffer;
  mimeType: string;
};

export type VertexImageOptions = {
  aspectRatio?: string;
  negativePrompt?: string;
  timeoutMs?: number;
};

/**
 * Uses Gemini's generateContent (responseModalities: ["IMAGE"]) rather than
 * the Imagen predict API - keeps hero-image generation on the same endpoint
 * as the rest of the Gemini calls in this file instead of the separately
 * Model-Garden-gated Imagen publisher models. Runs noticeably slower than a
 * text/JSON completion, so this gets its own default timeout instead of
 * reusing withVertexTimeout's 30s.
 */
export async function generateVertexImage(
  modelName: string,
  prompt: string,
  options: VertexImageOptions = {}
): Promise<VertexImageResult> {
  const ai = vertexClient();
  const fullPrompt = options.negativePrompt ? `${prompt}\n\nAvoid: ${options.negativePrompt}.` : prompt;

  const result = await withVertexRetry(
    () =>
      withVertexTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: fullPrompt,
          config: {
            responseModalities: ["IMAGE"],
            imageConfig: {
              aspectRatio: options.aspectRatio ?? "16:9",
              outputMimeType: "image/jpeg",
            },
          },
        }),
        options.timeoutMs ?? 90000
      ),
    { model: modelName } // image generation stays critical: image model has its own bucket + procedural fallback lives one level up
  );

  const parts = result.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    const blockReason = result.candidates?.[0]?.finishReason;
    throw new Error(blockReason ? `Vertex image blocked: ${blockReason}` : "Vertex returned no image bytes");
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, "base64"),
    mimeType: imagePart.inlineData.mimeType ?? "image/jpeg",
  };
}

export type VertexVisionOptions = {
  temperature?: number;
  maxOutputTokens?: number;
  schema?: SchemaUnion;
  timeoutMs?: number;
  /** "deferrable" fails fast while the quota circuit breaker is open. */
  priority?: "critical" | "deferrable";
};

/**
 * Same shape as generateVertexJson but for a multimodal (image + text)
 * prompt - used by quality-worker's image-relevance check (see
 * IMPLEMENTATION_PLAN.md's hero-image-quality addendum, Phase C.4).
 */
export async function generateVertexVisionJson<T>(
  modelName: string,
  prompt: string,
  image: { data: string; mimeType: string },
  options: VertexVisionOptions = {}
): Promise<VertexJsonResult<T>> {
  const ai = vertexClient();
  const config: GenerateContentConfig = {
    responseMimeType: "application/json",
    temperature: options.temperature ?? 0.2,
    ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.schema ? { responseSchema: options.schema } : {}),
  };

  const result = await withVertexRetry(
    () =>
      withVertexTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }, { inlineData: { data: image.data, mimeType: image.mimeType } }],
            },
          ],
          config,
        }),
        options.timeoutMs
      ),
    { model: modelName, priority: options.priority }
  );

  const text = result.text;
  if (!text) throw new Error("Gemini returned no text in response");

  return {
    data: extractJson<T>(text),
    usage: {
      promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

export async function generateVertexText(
  modelName: string,
  prompt: string,
  options: Omit<VertexJsonOptions, "schema"> = {}
): Promise<VertexTextResult> {
  if (!isVertexConfigured) {
    throw new Error("Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT and VERTEX_LOCATION.");
  }

  const ai = new GoogleGenAI({
    vertexai: true,
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.VERTEX_LOCATION,
  });
  const result = await withVertexRetry(
    () =>
      withVertexTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            temperature: options.temperature ?? 0.45,
            ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
          },
        }),
        options.timeoutMs
      ),
    { model: modelName, priority: options.priority }
  );

  const text = result.text;
  if (!text) throw new Error("Gemini returned no text in response");

  return {
    text: text.trim(),
    usage: {
      promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}
