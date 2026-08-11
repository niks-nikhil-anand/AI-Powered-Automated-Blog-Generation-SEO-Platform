import { env, isVertexConfigured } from "../../shared/env";
import { generateVertexJson } from "../../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../../shared/settings";
import { recordAIUsage, timed } from "../../shared/pricing";
import { prisma } from "../../shared/prisma";
import { logger } from "../../shared/logger";
import { z } from "zod";
import { researchConfig } from "../config";
import { NoveltyLayer, NoveltyVerdict, ResearchCandidate } from "../types";
import {
  entitySimilarity,
  extractEntities,
  keywordSimilarity,
  newDevelopmentSignal,
} from "../utils/similarity";
import { normalizeText } from "../utils/text";
import { cosineSimilarity } from "../../shared/embeddings";

const log = logger.child({ worker: "research-worker", stage: "novelty" });

/**
 * Topic memory / novelty (docs/RESEARCH_ENGINE_UPGRADE.md Phases 5-6).
 *
 * Exact title matching is not sufficient - "Microsoft launches AI agent for
 * automated unit test generation" and "Microsoft's AI-powered unit testing
 * agent" are the same story. So every candidate is compared against recent
 * history (Trends AND published Blogs) across several independent layers, from
 * cheapest/most-exact to most-semantic:
 *
 *   1. exact normalized title       5. semantic embedding cosine
 *   2. canonical URL                6. topic/entity overlap
 *   3. URL-independent fingerprint  7. published-blog similarity
 *   4. keyword Jaccard
 *
 * The result is a NoveltyVerdict: a 0-100 noveltyScore plus a freshness-window
 * decision (reject / penalize / allow). A legitimate follow-up (same entity,
 * materially NEW development) is allowed through instead of being rejected
 * purely for sharing an entity - see newDevelopmentSignal + the optional LLM
 * confirmation. Everything degrades gracefully: with embeddings off or Vertex
 * down, the deterministic layers still run.
 */

type HistoryEntry = {
  topic: string;
  normalizedTopic: string;
  canonicalUrl?: string;
  topicFingerprint?: string;
  embedding?: number[];
  entities: string[];
  createdAt: Date;
  isPublished: boolean;
};

export type TopicMemory = {
  entries: HistoryEntry[];
  lookbackCutoff: Date;
};

function daysAgo(date: Date): number {
  return Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
}

function parseEmbedding(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const nums = value.filter((v): v is number => typeof v === "number");
  return nums.length > 0 ? nums : undefined;
}

/**
 * Load recent Trends + published Blogs into an in-memory comparison set,
 * capped by RESEARCH_NOVELTY_MAX_HISTORY. Best-effort: a DB hiccup returns an
 * empty memory (novelty then allows everything - the safe direction, since a
 * false "novel" only costs a duplicate article, never a failed run).
 */
export async function loadTopicMemory(): Promise<TopicMemory> {
  const lookbackCutoff = new Date();
  lookbackCutoff.setDate(lookbackCutoff.getDate() - researchConfig.engine.noveltyLookbackDays);
  const cap = researchConfig.engine.noveltyMaxHistory;

  try {
    const [trends, blogs] = await Promise.all([
      prisma.trend.findMany({
        where: { createdAt: { gte: lookbackCutoff } },
        select: {
          topic: true,
          canonicalUrl: true,
          topicFingerprint: true,
          topicEmbedding: true,
          createdAt: true,
          status: true,
        },
        orderBy: { createdAt: "desc" },
        take: cap,
      }),
      prisma.blog.findMany({
        where: { status: "PUBLISHED", updatedAt: { gte: lookbackCutoff } },
        select: { title: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: Math.floor(cap / 2),
      }),
    ]);

    const entries: HistoryEntry[] = [
      ...trends.map((t) => ({
        topic: t.topic,
        normalizedTopic: normalizeText(t.topic),
        canonicalUrl: t.canonicalUrl ?? undefined,
        topicFingerprint: t.topicFingerprint ?? undefined,
        embedding: parseEmbedding(t.topicEmbedding),
        entities: extractEntities(t.topic),
        createdAt: t.createdAt,
        isPublished: t.status === "PROCESSED" || t.status === "PLANNED",
      })),
      ...blogs.map((b) => ({
        topic: b.title,
        normalizedTopic: normalizeText(b.title),
        canonicalUrl: undefined,
        topicFingerprint: undefined,
        embedding: undefined,
        entities: extractEntities(b.title),
        createdAt: b.updatedAt,
        isPublished: true,
      })),
    ];

    log.info("Topic memory loaded", {
      trends: trends.length,
      publishedBlogs: blogs.length,
      withEmbeddings: entries.filter((e) => e.embedding).length,
    });
    return { entries, lookbackCutoff };
  } catch (error) {
    log.warn("Failed to load topic memory, novelty will allow candidates", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { entries: [], lookbackCutoff };
  }
}

type LayerHit = { layer: NoveltyLayer; similarity: number; entry: HistoryEntry };

/** Find the strongest historical match across all layers. Pure/deterministic. */
function strongestMatch(
  memory: TopicMemory,
  input: {
    title: string;
    description?: string;
    canonicalUrl?: string;
    topicFingerprint?: string;
    embedding?: number[];
  }
): LayerHit | null {
  const cfg = researchConfig.engine;
  const normalizedTitle = normalizeText(input.title);
  const inputEntities = extractEntities(input.title);
  let best: LayerHit | null = null;

  const consider = (hit: LayerHit) => {
    if (!best || hit.similarity > best.similarity) best = hit;
  };

  for (const entry of memory.entries) {
    // 1. Exact normalized title
    if (normalizedTitle && entry.normalizedTopic === normalizedTitle) {
      consider({ layer: "exact_title", similarity: 1, entry });
      continue; // exact match is the ceiling for this entry
    }
    // 2. Canonical URL
    if (input.canonicalUrl && entry.canonicalUrl && input.canonicalUrl === entry.canonicalUrl) {
      consider({ layer: "canonical_url", similarity: 1, entry });
    }
    // 3. URL-independent fingerprint
    if (input.topicFingerprint && entry.topicFingerprint && input.topicFingerprint === entry.topicFingerprint) {
      consider({ layer: "fingerprint", similarity: 0.98, entry });
    }
    // 4. Keyword Jaccard
    const kw = keywordSimilarity(input.title, entry.topic, input.description);
    if (kw >= cfg.keywordSimilarityThreshold) {
      consider({ layer: entry.isPublished && !entry.topicFingerprint ? "published" : "keyword", similarity: kw, entry });
    }
    // 5. Semantic embedding cosine (only when both sides have vectors)
    if (input.embedding && entry.embedding) {
      const cos = cosineSimilarity(input.embedding, entry.embedding);
      if (cos >= cfg.semanticSimilarityThreshold) {
        consider({ layer: "embedding", similarity: cos, entry });
      }
    }
    // 6. Entity overlap
    if (inputEntities.length > 0 && entry.entities.length > 0) {
      const ent = entitySimilarity(input.title, entry.topic);
      if (ent >= 0.75) {
        consider({ layer: "entity", similarity: Math.min(0.9, ent * 0.9), entry });
      }
    }
  }

  return best;
}

const LlmNoveltySchema = z.object({
  materiallyNew: z.boolean(),
  reason: z.string(),
});

/**
 * Optional LLM "is this a genuinely new development" confirmation for a
 * borderline candidate that strongly matched history but lacks a deterministic
 * new-dev signal. One cheap Flash call, recorded, fail-soft to `null` (caller
 * then keeps the deterministic decision). Only invoked when
 * RESEARCH_LLM_NOVELTY_ENABLED is on.
 */
async function llmConfirmNewDevelopment(newTitle: string, oldTitle: string): Promise<boolean | null> {
  if (!researchConfig.engine.llmNoveltyEnabled || !isVertexConfigured) return null;
  const model = await getSetting(MODEL_SETTING_KEYS.semantic, env.VERTEX_FLASH);
  const prompt = `You are deciding whether a new article would be a genuinely NEW story or a rehash of an earlier one.

Earlier coverage:
"${oldTitle}"

Candidate:
"${newTitle}"

Answer "materiallyNew": true ONLY if the candidate describes a distinct, concrete new development (a new version, a new benchmark/result, a new launch, a security fix, a deprecation, a price change, an acquisition) rather than the same announcement reworded. Otherwise false.

Return ONLY JSON: { "materiallyNew": boolean, "reason": "one sentence" }`;

  try {
    const { result, latencyMs } = await timed(() =>
      generateVertexJson<unknown>(model, prompt, { timeoutMs: researchConfig.semanticTimeoutMs })
    );
    await recordAIUsage({ worker: "research-worker", model, usage: result.usage, latencyMs });
    const parsed = LlmNoveltySchema.safeParse(result.data);
    return parsed.success ? parsed.data.materiallyNew : null;
  } catch {
    return null;
  }
}

/**
 * Assess one candidate against topic memory, applying the freshness windows.
 * The deterministic decision is made first; the LLM new-development check only
 * runs for a strong match that the deterministic signal didn't already clear.
 */
export async function assessNovelty(
  memory: TopicMemory,
  candidate: ResearchCandidate,
  input: { canonicalUrl?: string; topicFingerprint?: string; embedding?: number[] }
): Promise<NoveltyVerdict> {
  const cfg = researchConfig.engine;
  const match = strongestMatch(memory, {
    title: candidate.title,
    description: candidate.evidence[0]?.description,
    canonicalUrl: input.canonicalUrl,
    topicFingerprint: input.topicFingerprint,
    embedding: input.embedding,
  });

  // No meaningful historical overlap -> fully novel.
  if (!match) {
    return {
      noveltyScore: 100,
      maxSimilarity: 0,
      layer: "none",
      decision: "allow",
      newDevelopment: false,
      reason: "No historical match across any novelty layer",
    };
  }

  const ageDays = daysAgo(match.entry.createdAt);
  const sim = match.similarity;

  // Phase 6: a materially new development can survive an entity/topic match.
  let newDev = newDevelopmentSignal(candidate.title, match.entry.topic) !== null;
  if (!newDev && sim >= cfg.semanticSimilarityThreshold) {
    const llm = await llmConfirmNewDevelopment(candidate.title, match.entry.topic);
    if (llm === true) newDev = true;
  }

  const base = {
    maxSimilarity: Math.round(sim * 1000) / 1000,
    layer: match.layer,
    matchedTopic: match.entry.topic,
    matchedAt: match.entry.createdAt.toISOString(),
    matchedAgeDays: Math.round(ageDays * 10) / 10,
  };

  if (newDev) {
    return {
      ...base,
      noveltyScore: 75,
      decision: "allow",
      newDevelopment: true,
      reason: `Similar to "${match.entry.topic}" but a materially new development was detected`,
    };
  }

  // Freshness windows (configurable). Same-day near-dup and recent very-similar
  // topics are rejected outright; older/moderate overlaps are only penalized.
  if (ageDays < 1 && sim >= 0.85) {
    return { ...base, noveltyScore: 5, decision: "reject", newDevelopment: false, reason: `Same topic already covered today via ${match.layer}` };
  }
  if (ageDays <= cfg.freshnessVerySimilarDays && sim >= 0.85) {
    return { ...base, noveltyScore: 10, decision: "reject", newDevelopment: false, reason: `Very similar topic within ${cfg.freshnessVerySimilarDays}d via ${match.layer}` };
  }
  if (ageDays <= cfg.freshnessHighlySimilarDays && sim >= cfg.semanticSimilarityThreshold) {
    return { ...base, noveltyScore: 20, decision: "reject", newDevelopment: false, reason: `Highly similar topic within ${cfg.freshnessHighlySimilarDays}d via ${match.layer}` };
  }
  if (ageDays <= cfg.freshnessSimilarDays && sim >= cfg.keywordSimilarityThreshold) {
    const noveltyScore = Math.round(Math.max(30, (1 - sim) * 100));
    return { ...base, noveltyScore, decision: "penalize", newDevelopment: false, reason: `Similar topic within ${cfg.freshnessSimilarDays}d via ${match.layer}; novelty penalty applied` };
  }

  // Old enough or different enough -> allow with a mild similarity-based discount.
  const noveltyScore = Math.round(Math.min(95, Math.max(55, (1 - sim) * 100 + 20)));
  return { ...base, noveltyScore, decision: "allow", newDevelopment: false, reason: `Only a weak/old historical match (${match.layer}, ${Math.round(ageDays)}d ago)` };
}
