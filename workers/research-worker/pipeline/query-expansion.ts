import { z } from "zod";
import { env, isVertexConfigured } from "../../shared/env";
import { generateVertexJson } from "../../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../../shared/settings";
import { recordAIUsage, timed } from "../../shared/pricing";
import { logger } from "../../shared/logger";
import { researchConfig } from "../config";
import { ExpandedQuery, QueryIntent, ResearchCandidate } from "../types";
import { extractEntities } from "../utils/similarity";

const log = logger.child({ worker: "research-worker", stage: "query-expansion" });

/**
 * Query expansion (docs/RESEARCH_ENGINE_UPGRADE.md Phase 3).
 *
 * Searching only the exact topic title under-covers a candidate, so each
 * promising candidate gets a small set of intent-tagged queries (official
 * docs, GitHub, benchmarks, community, ...). Deterministic templates run
 * FIRST and are the default; an optional batched Vertex call can propose a
 * few extra intents per candidate behind RESEARCH_LLM_QUERY_EXPANSION_ENABLED.
 *
 * Budgets are strict on two axes: the per-candidate cap
 * (RESEARCH_MAX_QUERIES_PER_CANDIDATE) enforced by the SERP layer, and the
 * run-wide SearXNG budget on the client. Provenance (origin + intent) is
 * attached to every query and persisted on Trend.researchDetail so a run can
 * be audited for "what did we actually search for".
 */

/** Strip trailing subtitle (after a colon/dash/pipe) so templates read naturally. */
function corePhrase(title: string): string {
  return title.split(/[—:|\-–/]/)[0].replace(/\s+/g, " ").trim();
}

/**
 * Deterministic, ordered query templates for one candidate. Order matters:
 * the SERP layer slices to the per-candidate cap, so the highest-value intents
 * (exact, official, GitHub, docs) come first. Entities let us add a couple of
 * paraphrase variants (the "Microsoft automated unit test generation" style
 * rewordings from the brief) without an LLM.
 */
export function templateQueries(candidate: ResearchCandidate): ExpandedQuery[] {
  const title = candidate.title.trim();
  const core = corePhrase(title);
  const entities = extractEntities(title);
  const queries: ExpandedQuery[] = [];
  const seen = new Set<string>();

  const push = (query: string, intent: QueryIntent) => {
    const q = query.replace(/\s+/g, " ").trim();
    const key = q.toLowerCase();
    if (q.length < 3 || seen.has(key)) return;
    seen.add(key);
    queries.push({ query: q, intent, origin: "template" });
  };

  push(title, "DISCOVERY");
  push(`${core} announcement`, "OFFICIAL");
  push(`${core} documentation`, "DOCUMENTATION");
  push(`${core} github`, "GITHUB");
  push(`how ${core} works`, "TECHNICAL");
  push(`${core} benchmark`, "BENCHMARK");
  push(`${core} discussion`, "COMMUNITY");
  push(`${core} alternative`, "ALTERNATIVE");

  // Entity-led paraphrase variants (deterministic rewording).
  if (entities.length > 0) {
    const lead = entities.slice(0, 2).join(" ");
    push(`${lead} ${candidate.keywords.slice(0, 3).join(" ")}`, "DISCOVERY");
  }

  return queries;
}

const LlmExpansionSchema = z.object({
  queries: z.array(
    z.object({
      topic: z.string(),
      query: z.string().min(3),
      intent: z.enum([
        "DISCOVERY",
        "OFFICIAL",
        "TECHNICAL",
        "GITHUB",
        "DOCUMENTATION",
        "BENCHMARK",
        "COMMUNITY",
        "ALTERNATIVE",
      ]),
    })
  ),
});

/**
 * Optional LLM expansion for a batch of candidates. Returns a map from
 * candidate index to its LLM-proposed queries (empty when disabled or on any
 * failure). One Vertex call for the whole batch keeps cost bounded; the call
 * is recorded via recordAIUsage. Never throws.
 */
async function llmExpandBatch(candidates: ResearchCandidate[]): Promise<Map<number, ExpandedQuery[]>> {
  const out = new Map<number, ExpandedQuery[]>();
  if (!researchConfig.engine.llmQueryExpansionEnabled || !isVertexConfigured || candidates.length === 0) {
    return out;
  }

  const model = await getSetting(MODEL_SETTING_KEYS.semantic, env.VERTEX_FLASH);
  const list = candidates
    .map((c, i) => `${i}. ${c.title} (keywords: ${c.keywords.slice(0, 5).join(", ")})`)
    .join("\n");
  const prompt = `You are helping a developer blog research new topics on the web.

For each numbered topic below, propose 2-3 HIGH-VALUE web search queries that would surface official docs, source repositories, benchmarks, or substantive technical coverage - not generic re-statements of the title. Tag each with one intent: DISCOVERY, OFFICIAL, TECHNICAL, GITHUB, DOCUMENTATION, BENCHMARK, COMMUNITY, ALTERNATIVE.

Topics:
${list}

Return ONLY JSON: { "queries": [ { "topic": "<exact topic title>", "query": "<search query>", "intent": "<INTENT>" } ] }`;

  try {
    const { result, latencyMs } = await timed(() =>
      generateVertexJson<unknown>(model, prompt, { timeoutMs: researchConfig.semanticTimeoutMs })
    );
    await recordAIUsage({
      worker: "research-worker",
      model,
      usage: result.usage,
      latencyMs,
    });

    const parsed = LlmExpansionSchema.safeParse(result.data);
    if (!parsed.success) {
      log.warn("LLM query expansion returned invalid shape, using templates only", { error: parsed.error.message });
      return out;
    }

    const indexByTitle = new Map(candidates.map((c, i) => [c.title, i] as const));
    for (const item of parsed.data.queries) {
      const index = indexByTitle.get(item.topic);
      if (index === undefined) continue;
      const existing = out.get(index) ?? [];
      existing.push({ query: item.query.trim(), intent: item.intent, origin: "llm" });
      out.set(index, existing);
    }
  } catch (error) {
    log.warn("LLM query expansion failed, using templates only", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return out;
}

/**
 * Expand queries for a batch of candidates: deterministic templates always,
 * LLM extras merged in (deduped) when enabled. Returns one ordered query list
 * per candidate, aligned by index.
 */
export async function expandQueriesForCandidates(
  candidates: ResearchCandidate[]
): Promise<ExpandedQuery[][]> {
  const base = candidates.map(templateQueries);
  const llm = await llmExpandBatch(candidates);

  return candidates.map((_, i) => {
    const merged = [...base[i]];
    const seen = new Set(base[i].map((q) => q.query.toLowerCase()));
    for (const extra of llm.get(i) ?? []) {
      const key = extra.query.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(extra);
      }
    }
    return merged;
  });
}
