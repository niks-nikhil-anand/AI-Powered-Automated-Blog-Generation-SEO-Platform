import { env, isVertexConfigured } from "./env";
import { requestVertex, VertexCapacityExhaustedError, type VertexPriority } from "./vertex-request";

export type VertexJsonResult<T> = { data: T; usage: { promptTokens: number; completionTokens: number } };
export type VertexTextResult = { text: string; usage: { promptTokens: number; completionTokens: number } };
export type VertexCallPriority = VertexPriority;

export class VertexQuotaError extends Error {
  constructor(public readonly args: { model: string; status: string; attempts: number; cause?: unknown }) {
    super(`Vertex quota exhausted for model "${args.model}" after ${args.attempts} attempt(s): ${args.status}`);
    this.name = "VertexQuotaError";
  }
  get model() { return this.args.model; }
  get status() { return this.args.status; }
  get attempts() { return this.args.attempts; }
}

export function logVertexRuntimeConfig(childLog: { info: (message: string, meta?: object) => void }): void {
  childLog.info("Vertex gateway config", {
    flashRpm: env.VERTEX_FLASH_RPM,
    proRpm: env.VERTEX_PRO_RPM,
    imageRpm: env.VERTEX_IMAGE_RPM,
    gatewayQueue: "vertex_queue",
  });
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

export function extractJson<T>(text: string, fallback?: T): T {
  try {
    const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return JSON.parse((fenced ? fenced[1] : text).trim()) as T;
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Failed to parse JSON from Vertex response: ${error}`);
  }
}

export type VertexJsonOptions = {
  schema?: unknown;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  priority?: VertexPriority;
};

/** Kept for batch callers; the gateway, rather than this delay, enforces quota. */
export function batchStagger(index: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, index * 50));
}

function assertConfigured() {
  if (!isVertexConfigured) throw new Error("Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT and VERTEX_LOCATION.");
}

async function requestWithQuotaError(request: Parameters<typeof requestVertex>[0]) {
  try {
    return await requestVertex(request);
  } catch (error) {
    if (error instanceof VertexCapacityExhaustedError) {
      throw new VertexQuotaError({
        model: request.model,
        status: error.code,
        attempts: error.args.attempts ?? env.VERTEX_RETRY_MAX_ATTEMPTS,
        cause: error,
      });
    }
    throw error;
  }
}

export async function generateVertexJson<T>(model: string, prompt: string, options: VertexJsonOptions = {}): Promise<VertexJsonResult<T>> {
  assertConfigured();
  const response = await requestWithQuotaError({ operation: "json", model, prompt, priority: options.priority ?? "critical", timeoutMs: options.timeoutMs, temperature: options.temperature, maxOutputTokens: options.maxOutputTokens, schema: options.schema });
  if (!response.text) throw new Error("Gemini returned no text in response");
  return { data: extractJson<T>(response.text), usage: response.usage };
}

export type VertexImageResult = { buffer: Buffer; mimeType: string };
export type VertexImageOptions = { aspectRatio?: string; negativePrompt?: string; timeoutMs?: number };

export async function generateVertexImage(model: string, prompt: string, options: VertexImageOptions = {}): Promise<VertexImageResult> {
  assertConfigured();
  const response = await requestWithQuotaError({ operation: "image", model, prompt, priority: "critical", timeoutMs: options.timeoutMs ?? 90_000, aspectRatio: options.aspectRatio, negativePrompt: options.negativePrompt });
  if (!response.image) throw new Error("Vertex returned no image bytes");
  return { buffer: Buffer.from(response.image.data, "base64"), mimeType: response.image.mimeType };
}

export type VertexVisionOptions = VertexJsonOptions;
export async function generateVertexVisionJson<T>(model: string, prompt: string, image: { data: string; mimeType: string }, options: VertexVisionOptions = {}): Promise<VertexJsonResult<T>> {
  assertConfigured();
  const response = await requestWithQuotaError({ operation: "vision-json", model, prompt, image, priority: options.priority ?? "critical", timeoutMs: options.timeoutMs, temperature: options.temperature, maxOutputTokens: options.maxOutputTokens, schema: options.schema });
  if (!response.text) throw new Error("Gemini returned no text in response");
  return { data: extractJson<T>(response.text), usage: response.usage };
}

export async function generateVertexText(model: string, prompt: string, options: Omit<VertexJsonOptions, "schema"> = {}): Promise<VertexTextResult> {
  assertConfigured();
  const response = await requestWithQuotaError({ operation: "text", model, prompt, priority: options.priority ?? "critical", timeoutMs: options.timeoutMs, temperature: options.temperature, maxOutputTokens: options.maxOutputTokens });
  if (!response.text) throw new Error("Gemini returned no text in response");
  return { text: response.text.trim(), usage: response.usage };
}
