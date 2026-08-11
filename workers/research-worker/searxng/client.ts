import { researchConfig } from "../config";
import { logger } from "../../shared/logger";
import { SerpResult } from "../types";

const log = logger.child({ worker: "research-worker", stage: "searxng" });

/**
 * Low-level SearXNG client (docs/RESEARCH_ENGINE_UPGRADE.md Phase 2).
 *
 * SearXNG is a self-hosted metasearch instance exposing `GET /search?...&
 * format=json`. This client is deliberately a *separate service module* from
 * the rest of the research pipeline (per the upgrade brief) so discovery and
 * candidate-research both go through one place that owns:
 *   - the per-run query budget (SEARXNG_MAX_QUERIES),
 *   - per-call timeout + bounded retry with backoff,
 *   - run-level stats (queries fired, results seen, unique domains),
 *   - and fail-soft semantics: NO call ever throws. A SearXNG outage, a
 *     disabled `format=json`, or a non-OK status all degrade to an empty
 *     result set so a research run can never be taken down by SearXNG.
 *
 * One client instance is created per research run (see engine.ts /
 * source.ts) so the budget and stats are scoped to that run.
 */

type SearxngRawResult = {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  category?: string;
  publishedDate?: string;
  score?: number;
};

type SearxngResponse = {
  results?: SearxngRawResult[];
};

export type SearxngSearchOverrides = {
  categories?: string;
  engines?: string;
  timeRange?: string;
  /** Override the per-query result cap for a single call. */
  resultsPerQuery?: number;
};

export type SearxngStats = {
  queries: number;
  results: number;
  uniqueDomains: number;
};

export class SearxngClient {
  private queriesUsed = 0;
  private resultsSeen = 0;
  private readonly domains = new Set<string>();
  private readonly maxQueries: number;

  constructor(maxQueries?: number) {
    this.maxQueries = maxQueries ?? researchConfig.searxng.maxQueries;
  }

  /** True while this run still has query budget left. */
  get hasBudget(): boolean {
    return this.queriesUsed < this.maxQueries;
  }

  get stats(): SearxngStats {
    return { queries: this.queriesUsed, results: this.resultsSeen, uniqueDomains: this.domains.size };
  }

  /**
   * Run one query. Never throws and never exceeds the budget - returns []
   * when the budget is exhausted, SearXNG is disabled, or the call fails.
   */
  async search(query: string, overrides: SearxngSearchOverrides = {}): Promise<SerpResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    if (!researchConfig.searxng.enabled) return [];
    if (!this.hasBudget) {
      log.warn("SearXNG query budget exhausted for this run, skipping query", { query: trimmed });
      return [];
    }

    this.queriesUsed += 1;
    const cfg = researchConfig.searxng;
    const params = new URLSearchParams({ q: trimmed, format: "json" });
    if (cfg.language) params.set("language", cfg.language);
    const categories = overrides.categories ?? cfg.categories;
    if (categories) params.set("categories", categories);
    const engines = overrides.engines ?? cfg.engines;
    if (engines) params.set("engines", engines);
    if (cfg.safeSearch) params.set("safesearch", cfg.safeSearch);
    const timeRange = overrides.timeRange ?? cfg.timeRange;
    if (timeRange) params.set("time_range", timeRange);

    const base = cfg.baseUrl.replace(/\/+$/, "");
    const url = `${base}/search?${params.toString()}`;
    const cap = overrides.resultsPerQuery ?? cfg.resultsPerQuery;

    const results = await this.fetchWithBackoff(url);
    const normalized = results
      .filter((r) => r.url && r.title)
      .slice(0, cap)
      .map((r) => ({
        title: String(r.title).trim(),
        url: String(r.url),
        snippet: r.content ? String(r.content).trim() : undefined,
        engine: r.engine,
        category: r.category,
        publishedDate: r.publishedDate,
        score: typeof r.score === "number" ? r.score : undefined,
      }));

    this.resultsSeen += normalized.length;
    for (const r of normalized) {
      try {
        this.domains.add(new URL(r.url).hostname.toLowerCase().replace(/^www\./, ""));
      } catch {
        // ignore unparseable URLs for the domain stat
      }
    }
    return normalized;
  }

  /** Timeout + bounded exponential-backoff retry around a single /search call. */
  private async fetchWithBackoff(url: string): Promise<SearxngRawResult[]> {
    const cfg = researchConfig.searxng;
    const attempts = 3;
    let lastError = "";

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": researchConfig.userAgent,
            Accept: "application/json",
          },
        });
        clearTimeout(timeout);

        if (!res.ok) {
          lastError = `${res.status} ${res.statusText}`;
          // 4xx (e.g. 403 when format=json is disabled, 429 rate limit) won't
          // benefit from a retry except 429 - don't burn budget on them.
          if (res.status !== 429) {
            log.warn("SearXNG returned non-OK, giving up on this query", { status: res.status });
            return [];
          }
        } else {
          const data = (await res.json()) as SearxngResponse;
          return data.results ?? [];
        }
      } catch (error) {
        clearTimeout(timeout);
        lastError = error instanceof Error ? error.message : String(error);
      }

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 600));
      }
    }

    log.warn("SearXNG query failed after retries (failing soft)", { error: lastError });
    return [];
  }
}

/** Convenience factory - one budgeted client per research run. */
export function createSearxngClient(maxQueries?: number): SearxngClient {
  return new SearxngClient(maxQueries);
}
