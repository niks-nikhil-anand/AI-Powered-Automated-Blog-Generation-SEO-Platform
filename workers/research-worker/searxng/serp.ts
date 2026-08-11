import { researchConfig } from "../config";
import { logger } from "../../shared/logger";
import { ExpandedQuery, SerpResult } from "../types";
import { SearxngClient } from "./client";

const log = logger.child({ worker: "research-worker", stage: "searxng-serp" });

/**
 * SearXNG as a candidate RESEARCH / validation layer (docs/RESEARCH_ENGINE_UPGRADE.md
 * Phases 3, 8, 10) - distinct from the discovery source. Given a candidate's
 * expanded queries (each carrying an intent), it gathers the SERP results the
 * evidence-quality and content-gap scorers analyze. It deliberately does NOT
 * select topics itself: it only produces the raw landscape + evidence URLs that
 * the shared selection pipeline scores, so SearXNG research is a separate
 * service concern without being a parallel topic-selection system.
 *
 * Honors BOTH the per-candidate query cap (RESEARCH_MAX_QUERIES_PER_CANDIDATE)
 * and the shared per-run budget on the client, whichever runs out first. Never
 * throws - a candidate whose SERP research fails simply gets an empty result
 * set, which downstream scorers treat as "no web evidence" rather than an error.
 */
export async function researchCandidateOnSerp(
  client: SearxngClient,
  queries: ExpandedQuery[]
): Promise<{ results: SerpResult[]; queriesRun: string[] }> {
  const cap = researchConfig.engine.maxQueriesPerCandidate;
  const byUrl = new Map<string, SerpResult>();
  const queriesRun: string[] = [];

  for (const expanded of queries.slice(0, cap)) {
    if (!client.hasBudget) {
      log.warn("Shared SearXNG budget exhausted mid-candidate", { remaining: queries.length - queriesRun.length });
      break;
    }
    const results = await client.search(expanded.query);
    if (results.length > 0) queriesRun.push(expanded.query);
    for (const result of results) {
      // First-seen wins: an earlier (higher-intent) query's copy of a URL is
      // kept so the result set stays stable/deterministic.
      if (!byUrl.has(result.url)) byUrl.set(result.url, result);
    }
  }

  return { results: Array.from(byUrl.values()), queriesRun };
}
