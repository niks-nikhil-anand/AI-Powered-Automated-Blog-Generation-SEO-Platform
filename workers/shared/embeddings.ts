import { GoogleGenAI } from "@google/genai";
import { env, isVertexConfigured } from "./env";
import { logger } from "./logger";
import { recordAIUsage, timed } from "./pricing";
import { withVertexRetry } from "./vertex";

const log = logger.child({ worker: "research-worker", stage: "embeddings" });

/**
 * Gemini text-embedding helper for the research engine's topic memory
 * (docs/RESEARCH_ENGINE_UPGRADE.md Phase 5).
 *
 * The repo has no pgvector/Qdrant today (the WORKER_ENHANCEMENT_GUIDE lists
 * pgvector as a future item, R2). At the scale this pipeline operates at -
 * hundreds of trends, capped by RESEARCH_NOVELTY_MAX_HISTORY - an in-process
 * cosine scan over embeddings stored as Trend.topicEmbedding (JSON number[])
 * is simpler, dependency-free and deterministic, so that's what the novelty
 * layer uses. If pgvector lands later, only this module's storage/comparison
 * call sites change, not the embeddings themselves.
 *
 * Embeddings are billed per token, so the model defaults to the cheap
 * text-embedding-004 and every call records AIUsage. All public functions
 * fail soft (return null / 0) so a Vertex outage can never break a run - the
 * novelty layer then just falls back to its free deterministic layers.
 */
const EMBEDDING_MODEL = "text-embedding-004";

function client(): GoogleGenAI {
  if (!isVertexConfigured) {
    throw new Error("Vertex AI is not configured - cannot compute embeddings");
  }
  return new GoogleGenAI({
    vertexai: true,
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.VERTEX_LOCATION,
  });
}

/** Cosine similarity in [-1, 1]. Returns 0 for empty/mismatched/zero vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Embed one text. Returns the vector, or null when Vertex is unavailable or
 * the call fails (best-effort - the caller degrades to non-embedding novelty).
 */
export async function embedText(text: string, trendId?: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed || !isVertexConfigured) return null;

  try {
    // Through withVertexRetry (docs/VERTEX_429_RESOLUTION_PLAN.md Step 3.3):
    // embedContent bypassed the resilience layer before, so a transient 429
    // killed the call with no retry and no RPM pacing. Deferrable: novelty
    // falls back to free deterministic layers when it's shed.
    const { result, latencyMs } = await timed(() =>
      withVertexRetry(() => client().models.embedContent({ model: EMBEDDING_MODEL, contents: trimmed }), {
        model: EMBEDDING_MODEL,
        priority: "deferrable",
      })
    );
    const values = result.embeddings?.[0]?.values;
    if (!values || values.length === 0) return null;

    // embedContent doesn't return token usage on every SDK version; estimate
    // from ~4 chars/token so cost tracking never silently drops the spend.
    const promptTokens = Math.max(1, Math.ceil(trimmed.length / 4));
    await recordAIUsage({
      worker: "research-worker",
      model: EMBEDDING_MODEL,
      usage: { promptTokens, completionTokens: 0 },
      latencyMs,
      trendId: trendId ?? null,
    });
    return values;
  } catch (error) {
    log.warn("Embedding call failed, novelty will use deterministic layers only", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Embed many texts with bounded parallelism. Indexes are preserved - a failed
 * item yields null at its position. Bounded so a large candidate pool can't
 * fire hundreds of concurrent embedding requests.
 */
export async function embedMany(texts: string[], concurrency = 6): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = new Array(texts.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await embedText(texts[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
  return out;
}
