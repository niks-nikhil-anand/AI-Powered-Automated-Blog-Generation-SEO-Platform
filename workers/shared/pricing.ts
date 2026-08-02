/**
 * Vertex AI pricing + AI usage recording.
 *
 * Prices are USD per 1,000,000 tokens and match Google Cloud's published
 * Vertex AI generative AI pricing for the models this pipeline uses. Update
 * MODEL_PRICING if Google changes list prices or you negotiate committed-use
 * discounts.
 */
import { prisma } from "./prisma";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
};

type ModelPrice = {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M output tokens */
  output: number;
};

/** USD per 1M tokens. Keys are matched by prefix, longest match wins. */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash": { input: 0.15, output: 0.6 },
  // Local SVG hero generator - no API call, no cost.
  fallback: { input: 0, output: 0 },
  local: { input: 0, output: 0 },
};

const PRICING_KEYS = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);

export function priceForModel(model: string): ModelPrice {
  const normalized = model.toLowerCase();
  const key = PRICING_KEYS.find((candidate) => normalized.startsWith(candidate));
  return key ? MODEL_PRICING[key] : { input: 0, output: 0 };
}

/** Cost in USD for a single generateContent call. */
export function calculateCost(usage: TokenUsage, model: string): number {
  const price = priceForModel(model);
  const cost =
    (usage.promptTokens * price.input + usage.completionTokens * price.output) / 1_000_000;
  // Round to 8 decimals so tiny Flash calls don't disappear into float noise.
  return Math.round(cost * 1e8) / 1e8;
}

export type RecordUsageInput = {
  worker: string;
  model: string;
  usage: TokenUsage;
  /** Milliseconds from request start to response, measured by the caller. */
  latencyMs: number;
  blogId?: string | null;
  trendId?: string | null;
};

/**
 * Persist one AI call with its real cost. Never throws - usage accounting must
 * not be able to fail an otherwise successful worker job.
 */
export async function recordAIUsage(input: RecordUsageInput): Promise<{ id: string | null; cost: number }> {
  const cost = calculateCost(input.usage, input.model);
  try {
    const row = await prisma.aIUsage.create({
      data: {
        worker: input.worker,
        model: input.model,
        blogId: input.blogId ?? null,
        trendId: input.trendId ?? null,
        promptTokens: input.usage.promptTokens,
        completionTokens: input.usage.completionTokens,
        cost,
        latency: Math.max(0, Math.round(input.latencyMs)),
      },
    });
    return { id: row.id, cost };
  } catch {
    // Swallow - accounting is best-effort and must never fail a job.
    return { id: null, cost };
  }
}

/**
 * Back-fill the blog link once the blog row exists. Used by the writing worker,
 * which must record token spend *before* its quality gate so failed drafts
 * still show up in cost reporting.
 */
export async function attachUsageToBlog(usageId: string | null, blogId: string) {
  if (!usageId) return;
  try {
    await prisma.aIUsage.update({ where: { id: usageId }, data: { blogId } });
  } catch {
    // Best-effort.
  }
}

/** Time an async call and return its duration alongside the result. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}
