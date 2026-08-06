import { z } from "zod";
import { env, isVertexConfigured } from "../../shared/env";
import { generateVertexJson } from "../../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../../shared/settings";
import { logger } from "../../shared/logger";
import { researchConfig } from "../config";
import { SignalCluster } from "./dedupe";

const log = logger.child({ worker: "research-worker" });

/**
 * A SignalCluster after the LLM enrichment pass has run (or after the
 * fallback path, when it hasn't). semanticRelevance is 0 whenever the
 * pass was skipped or failed - see semanticEnrich below - so downstream
 * scoring degrades to the pre-existing heuristic-only score rather than
 * treating "no data" as "irrelevant."
 */
export type EnrichedCluster = SignalCluster & {
  semanticRelevance: number;
  semanticReason?: string;
};

type SemanticClusterInput = {
  clusterId: string;
  title: string;
  keywords: string[];
  sourceCount: number;
};

/**
 * Schema-validates the batched Vertex response instead of trusting whatever
 * extractJson's JSON.parse returns as `any` - see IMPLEMENTATION_PLAN.md
 * Phase 2.6. Replaces the old manual `Array.isArray(...)` spot-check below.
 */
const SemanticClusterOutputSchema = z.object({
  clusterId: z.string().min(1),
  relevance: z.number(),
  duplicateOfClusterId: z.string().nullable(),
  reason: z.string(),
});

const SemanticResultSchema = z.object({
  clusters: z.array(SemanticClusterOutputSchema),
});

type SemanticClusterOutput = z.infer<typeof SemanticClusterOutputSchema>;

function buildPrompt(inputs: SemanticClusterInput[]): string {
  const categoryList = researchConfig.categories.join(", ");
  return `You are a technical content strategist for a developer-focused blog covering ${categoryList}.

You will evaluate a batch of candidate news/trend clusters for two things:

1. Relevance: how good a blog topic each one is for this audience - substantive and explainable to developers, not just viral noise. Score 0-100.
2. Duplicates: whether any cluster describes the SAME underlying story as another cluster in this batch, even if worded completely differently (for example "OpenAI ships GPT-5.2" and "Sam Altman's company launches new flagship model" are the same story). If so, set duplicateOfClusterId to that other cluster's id; otherwise null. Never set a cluster as a duplicate of itself.

Clusters:
${inputs
  .map(
    (c) =>
      `- id: ${c.clusterId}\n  title: ${c.title}\n  keywords: ${c.keywords.join(", ") || "(none)"}\n  distinct sources reporting it: ${c.sourceCount}`
  )
  .join("\n")}

Return ONLY a JSON object with this exact shape, with exactly one entry per cluster id listed above:
{
  "clusters": [
    { "clusterId": "string matching an id above", "relevance": 0-100, "duplicateOfClusterId": "string or null", "reason": "one sentence explaining the relevance score" }
  ]
}`;
}

function toFallback(clusters: SignalCluster[]): EnrichedCluster[] {
  return clusters.map((cluster) => ({ ...cluster, semanticRelevance: 0 }));
}

/**
 * Merge clusters the model flagged as duplicateOfClusterId using a simple
 * union-find, then attach the (max, if a group merged) relevance score.
 * Guards against three ways the model can misbehave: pointing at an id that
 * was never in the batch, pointing at itself, and a duplicate cycle
 * (A->B->A) that would otherwise loop forever.
 */
function mergeAndScore(clusters: SignalCluster[], scored: SemanticClusterOutput[]): EnrichedCluster[] {
  const validIds = new Set(clusters.map((c) => c.key));
  const scoreById = new Map(
    scored.filter((s) => validIds.has(s.clusterId)).map((s) => [s.clusterId, s] as const)
  );

  const parent = new Map<string, string>();
  function find(id: string): string {
    const seen = new Set<string>();
    let root = id;
    while (parent.has(root) && !seen.has(root)) {
      seen.add(root);
      root = parent.get(root)!;
    }
    return root;
  }

  for (const s of scored) {
    if (!validIds.has(s.clusterId)) continue;
    if (!s.duplicateOfClusterId || !validIds.has(s.duplicateOfClusterId)) continue;
    if (s.duplicateOfClusterId === s.clusterId) continue;
    const a = find(s.clusterId);
    const b = find(s.duplicateOfClusterId);
    if (a !== b) parent.set(a, b);
  }

  const groups = new Map<string, SignalCluster[]>();
  for (const cluster of clusters) {
    const root = find(cluster.key);
    const group = groups.get(root) ?? [];
    group.push(cluster);
    groups.set(root, group);
  }

  const merged: EnrichedCluster[] = [];
  for (const group of groups.values()) {
    const relevances = group
      .map((c) => scoreById.get(c.key)?.relevance)
      .filter((v): v is number => typeof v === "number");
    const reason = group.map((c) => scoreById.get(c.key)?.reason).find(Boolean);
    merged.push({
      key: group[0].key,
      signals: group.flatMap((c) => c.signals),
      semanticRelevance: relevances.length > 0 ? Math.max(...relevances) : 0,
      semanticReason: reason,
    });
  }

  return merged;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Runs one Vertex call per batch of researchConfig.semanticBatchSize
 * clusters, in parallel, instead of one call holding every cluster from
 * the run. A run with 100+ clusters in a single prompt was routinely
 * hitting Vertex's timeout, and on timeout the old code discarded semantic
 * scores for every cluster in the run, not just the slow ones. Batching
 * means a failed batch only costs its own clusters (they fall back to
 * heuristic-only via mergeAndScore's existing "no score found" path -
 * nothing special-cased here), while every other batch's real scores still
 * land. Cost: duplicate detection only ever worked within one prompt, so it
 * now only catches duplicates that land in the same batch - a real
 * trade-off, not a free lunch, but dedupeSignals() already ran a heuristic
 * pass before this one, so this is a secondary refinement losing some
 * cross-batch coverage, not the only dedup pass in the pipeline.
 */
export async function semanticEnrich(clusters: SignalCluster[]): Promise<EnrichedCluster[]> {
  if (clusters.length === 0) return [];

  if (!researchConfig.semanticEnabled) {
    return toFallback(clusters);
  }

  if (!isVertexConfigured) {
    log.warn("Vertex AI not configured - skipping semantic scoring, using heuristic score only");
    return toFallback(clusters);
  }

  const inputs: SemanticClusterInput[] = clusters.map((cluster) => ({
    clusterId: cluster.key,
    title: cluster.signals[0]?.title ?? "",
    keywords: Array.from(new Set(cluster.signals.flatMap((s) => s.keywords))).slice(0, 8),
    sourceCount: new Set(cluster.signals.map((s) => s.source)).size,
  }));

  const batches = chunk(inputs, researchConfig.semanticBatchSize);
  const model = await getSetting(MODEL_SETTING_KEYS.semantic, env.VERTEX_FLASH);

  log.info(
    `Semantic scoring ${clusters.length} cluster(s) in ${batches.length} batch(es) of up to ${researchConfig.semanticBatchSize}`
  );

  const results = await Promise.allSettled(
    batches.map((batch) =>
      generateVertexJson<unknown>(model, buildPrompt(batch), { timeoutMs: researchConfig.semanticTimeoutMs })
    )
  );

  const scored: SemanticClusterOutput[] = [];
  let failedBatches = 0;

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failedBatches += 1;
      log.warn(
        `Semantic scoring batch ${index + 1}/${batches.length} failed, its clusters fall back to heuristic score only: ${
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        }`
      );
      return;
    }

    const parsed = SemanticResultSchema.safeParse(result.value.data);
    if (!parsed.success) {
      failedBatches += 1;
      log.warn(
        `Semantic scoring batch ${index + 1}/${batches.length} returned an invalid response, its clusters fall back to heuristic score only: ${parsed.error.message}`
      );
      return;
    }

    scored.push(...parsed.data.clusters);
  });

  if (failedBatches > 0) {
    log.warn(`${failedBatches}/${batches.length} semantic scoring batch(es) failed this run`);
  }

  return mergeAndScore(clusters, scored);
}
