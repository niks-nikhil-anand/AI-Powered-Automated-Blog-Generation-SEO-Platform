import { researchConfig } from "../config";
import { logger } from "../../shared/logger";
import { RawSignal, ResearchSource } from "../types";
import { SearxngClient, createSearxngClient } from "./client";

const log = logger.child({ worker: "research-worker", stage: "searxng-discovery" });

/**
 * SearXNG as a DISCOVERY source (docs/RESEARCH_ENGINE_UPGRADE.md Phase 2).
 *
 * It runs the configured SEARXNG_DISCOVERY_QUERIES and turns the SERP results
 * into RawSignals with source "searxng", which then flow through the exact
 * same normalize -> dedupe -> score pipeline as every other source. This is
 * what makes SearXNG strictly ADDITIVE: it widens the candidate pool with
 * fresh web results alongside Google Trends / News / GitHub rather than
 * replacing them.
 *
 * Accepts an optional shared client so the research ENGINE can run discovery
 * and per-candidate research off ONE query budget (engine.ts); the standalone
 * source export creates its own client for the legacy path, where it is the
 * only SearXNG consumer. Never throws - a SearXNG outage yields 0 signals,
 * handled like any other soft source result.
 */
export async function fetchSearxngDiscoverySignals(
  client: SearxngClient = createSearxngClient()
): Promise<RawSignal[]> {
  const queries = researchConfig.searxng.discoveryQueries;
  if (queries.length === 0) return [];

  const byUrl = new Map<string, RawSignal>();

  for (const query of queries) {
    if (!client.hasBudget) break;
    const results = await client.search(query, {
      resultsPerQuery: Math.min(researchConfig.searxng.resultsPerQuery, researchConfig.maxSignalsPerSource),
    });
    for (const result of results) {
      if (!byUrl.has(result.url)) {
        byUrl.set(result.url, {
          source: "searxng",
          title: result.title,
          url: result.url,
          description: result.snippet,
          snippet: result.snippet,
          publishedAt: result.publishedDate ? new Date(result.publishedDate) : undefined,
          // Give SERP results a baseline engagement signal so the existing
          // scorer treats a strongly-ranked result as non-zero without
          // overstating it. Position/score is weak vs. real trend volume, so
          // keep it modest.
          engagement: 1,
          tags: ["serp", result.engine, result.category].filter(Boolean) as string[],
          raw: { query, score: result.score },
        });
      }
    }
  }

  const signals = Array.from(byUrl.values()).slice(0, researchConfig.maxSignalsPerSource);
  log.info("SearXNG discovery signals", { queries: queries.length, signals: signals.length });
  return signals;
}

/**
 * Standalone source for the legacy path's getEnabledSources(). Creates its own
 * client (its own budget) because in the legacy pipeline it is the only
 * SearXNG consumer. The engine path calls fetchSearxngDiscoverySignals(shared)
 * directly instead, so the two never double-fetch.
 */
export const searxngSource: ResearchSource = {
  name: "searxng",
  displayName: "SearXNG",
  fetchSignals: () => fetchSearxngDiscoverySignals(),
};
