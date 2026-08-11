import { logger } from "../../shared/logger";
import {
  EvidenceProfile,
  ExpandedQuery,
  ResearchCandidate,
  SerpResult,
  TieredSource,
} from "../types";
import { SearxngClient, researchCandidateOnSerp } from "../searxng";
import { tierForUrl } from "./source-tiers";
import { domainOf, extractEntities } from "../utils/similarity";
import { extractKeywords } from "../utils/text";

const log = logger.child({ worker: "research-worker", stage: "evidence-research" });

/**
 * Evidence research + quality + content-gap (docs/RESEARCH_ENGINE_UPGRADE.md
 * Phases 8-10). For each serious candidate it merges TWO evidence pools:
 *   - the candidate's existing source signals (Google Trends/News/GitHub/...),
 *   - SearXNG SERP results for the candidate's expanded queries,
 * tiers every source by authority, then derives:
 *   - an Evidence Quality score (Phase 9) and
 *   - a Content Opportunity score from the search landscape (Phase 10).
 *
 * The "don't count five re-posts of one announcement as five validations" rule
 * is handled by counting INDEPENDENT DOMAINS and by tier weighting, not raw
 * link count. Never throws - a candidate with no usable web evidence just gets
 * a low (honest) evidence score.
 */

const FRESH_WINDOW_DAYS = 30;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Convert the candidate's first-party source signals into tiered sources. */
function signalsToSources(candidate: ResearchCandidate, entity?: string): TieredSource[] {
  const out: TieredSource[] = [];
  for (const signal of candidate.evidence) {
    if (!signal.url) continue;
    out.push({
      title: signal.title,
      url: signal.url,
      snippet: signal.description ?? signal.snippet,
      publishedDate: signal.publishedAt ? signal.publishedAt.toISOString() : undefined,
      domain: domainOf(signal.url),
      tier: tierForUrl(signal.url, entity),
      engine: signal.source,
    });
  }
  return out;
}

function toTiered(result: SerpResult, entity?: string): TieredSource {
  return { ...result, domain: domainOf(result.url), tier: tierForUrl(result.url, entity) };
}

function isFresh(source: TieredSource): boolean {
  if (!source.publishedDate) return false;
  const time = new Date(source.publishedDate).getTime();
  if (Number.isNaN(time)) return false;
  return (Date.now() - time) / 86_400_000 <= FRESH_WINDOW_DAYS;
}

/** Share of a source's title keywords that also appear in the candidate (relevance proxy). */
function relevanceOf(source: TieredSource, candidateKeywords: Set<string>): boolean {
  const words = new Set(extractKeywords(source.title, source.snippet));
  for (const word of words) {
    if (candidateKeywords.has(word)) return true;
  }
  return false;
}

/** Herfindahl-Hirschman concentration over domains, 0 (fragmented) .. 1 (one domain dominates). */
function domainConcentration(sources: TieredSource[]): number {
  if (sources.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const s of sources) counts.set(s.domain, (counts.get(s.domain) ?? 0) + 1);
  let hhi = 0;
  for (const count of counts.values()) {
    const share = count / sources.length;
    hhi += share * share;
  }
  return Math.round(hhi * 1000) / 1000;
}

function computeEvidenceQuality(
  sources: TieredSource[],
  candidateKeywords: Set<string>
): EvidenceProfile["evidenceQuality"] {
  const totalSources = sources.length;
  const domains = new Set(sources.map((s) => s.domain).filter(Boolean));
  const independentDomains = domains.size;
  const tier1 = sources.filter((s) => s.tier === 1).length;
  const dated = sources.filter((s) => s.publishedDate);
  const freshRatio = dated.length > 0 ? dated.filter(isFresh).length / dated.length : 0.5;
  const relevant = sources.filter((s) => relevanceOf(s, candidateKeywords)).length;

  // Completeness: more sources AND more independent domains = more complete.
  const completeness = clamp(independentDomains * 18 + totalSources * 4);
  // Authority: tier-weighted average (tier1=100, tier2=65, tier3=30) + primary bonus.
  const tierScore = totalSources > 0
    ? sources.reduce((sum, s) => sum + (s.tier === 1 ? 100 : s.tier === 2 ? 65 : 30), 0) / totalSources
    : 0;
  const authority = clamp(tierScore + Math.min(20, tier1 * 10));
  // Diversity: how non-echo-chamber the set is.
  const diversity = clamp(totalSources > 0 ? (independentDomains / totalSources) * 70 + Math.min(30, independentDomains * 4) : 0);
  // Freshness: share of dated sources that are recent.
  const freshness = clamp(freshRatio * 100);
  // Relevance: share of sources topically on-point.
  const relevance = clamp(totalSources > 0 ? (relevant / totalSources) * 100 : 0);

  const total = clamp(
    completeness * 0.2 + authority * 0.3 + diversity * 0.2 + freshness * 0.1 + relevance * 0.2
  );
  return { completeness, authority, diversity, freshness, relevance, total };
}

function computeContentOpportunity(
  serpResults: SerpResult[],
  sources: TieredSource[]
): EvidenceProfile["contentOpportunity"] {
  const resultCount = serpResults.length;
  const concentration = domainConcentration(sources);
  const tier1 = sources.filter((s) => s.tier === 1).length;
  const tier3 = sources.filter((s) => s.tier === 3).length;
  const shallowRatio = sources.length > 0 ? Math.round((tier3 / sources.length) * 1000) / 1000 : 0;
  const hasAuthoritative = tier1 > 0;

  // Demand: zero results usually means zero demand (per the brief), a moderate
  // result count is the sweet spot, and a heavily saturated SERP is harder to
  // win. Bell-shaped, not monotonic.
  const demand = resultCount === 0 ? 15 : resultCount <= 2 ? 45 : resultCount <= 20 ? 80 : 68;
  // Gap: fragmented (low concentration) + shallow (forum/listicle-heavy)
  // existing content = room for a clearly better article.
  const gap = clamp(shallowRatio * 60 + (1 - concentration) * 40);
  // Some authoritative content is good (we can ground on it); a SERP that's
  // already wall-to-wall official docs is harder to add value beyond.
  const authoritativeBonus = tier1 >= 1 && tier1 <= 2 ? 8 : tier1 >= 3 ? -10 : 0;

  const opportunity = clamp(demand * 0.5 + gap * 0.45 + authoritativeBonus);

  return {
    resultCount,
    domainConcentration: concentration,
    shallowRatio,
    hasAuthoritative,
    opportunity,
  };
}

/**
 * Build the full evidence profile for one candidate. Combines first-party
 * signals + SearXNG SERP results (deduped by canonical URL), tiers them, and
 * computes the evidence-quality + content-opportunity scores.
 */
export async function buildEvidenceProfile(
  client: SearxngClient,
  candidate: ResearchCandidate,
  queries: ExpandedQuery[]
): Promise<EvidenceProfile> {
  const entity = extractEntities(candidate.title)[0];
  const candidateKeywords = new Set(extractKeywords(candidate.title, candidate.evidence[0]?.description));

  // SERP research (fail-soft; empty when SearXNG disabled/unavailable).
  const { results: serpResults, queriesRun } = await researchCandidateOnSerp(client, queries);

  // Merge first-party signals + SERP results, deduping by canonical URL so a
  // page that appears in both is only counted once.
  const byUrl = new Map<string, TieredSource>();
  for (const source of signalsToSources(candidate, entity)) {
    if (!byUrl.has(source.url)) byUrl.set(source.url, source);
  }
  for (const result of serpResults) {
    if (!byUrl.has(result.url)) byUrl.set(result.url, toTiered(result, entity));
  }
  const sources = Array.from(byUrl.values());

  const domains = new Set(sources.map((s) => s.domain).filter(Boolean));
  const tier1Count = sources.filter((s) => s.tier === 1).length;
  const tier2Count = sources.filter((s) => s.tier === 2).length;
  const tier3Count = sources.filter((s) => s.tier === 3).length;
  const dated = sources.filter((s) => s.publishedDate);
  const freshSourceRatio = dated.length > 0 ? Math.round((dated.filter(isFresh).length / dated.length) * 1000) / 1000 : 0;

  const evidenceQuality = computeEvidenceQuality(sources, candidateKeywords);
  const contentOpportunity = computeContentOpportunity(serpResults, sources);

  log.info("Evidence profile built", {
    topic: candidate.title.slice(0, 60),
    serpQueriesRun: queriesRun.length,
    serpResults: serpResults.length,
    totalSources: sources.length,
    independentDomains: domains.size,
    tier1Count,
    evidenceQuality: evidenceQuality.total,
    opportunity: contentOpportunity.opportunity,
  });

  return {
    sources,
    totalSources: sources.length,
    independentDomains: domains.size,
    primarySources: tier1Count,
    tier1Count,
    tier2Count,
    tier3Count,
    freshSourceRatio,
    evidenceQuality,
    contentOpportunity,
  };
}

/**
 * A minimal, SearXNG-free evidence profile used when SearXNG is disabled - the
 * candidate's existing source signals are still tiered and scored, so the
 * engine works (degraded) without any SERP layer.
 */
export function buildOfflineEvidenceProfile(candidate: ResearchCandidate): EvidenceProfile {
  const entity = extractEntities(candidate.title)[0];
  const candidateKeywords = new Set(extractKeywords(candidate.title, candidate.evidence[0]?.description));
  const sources = signalsToSources(candidate, entity);
  const domains = new Set(sources.map((s) => s.domain).filter(Boolean));
  const tier1Count = sources.filter((s) => s.tier === 1).length;
  const dated = sources.filter((s) => s.publishedDate);

  return {
    sources,
    totalSources: sources.length,
    independentDomains: domains.size,
    primarySources: tier1Count,
    tier1Count,
    tier2Count: sources.filter((s) => s.tier === 2).length,
    tier3Count: sources.filter((s) => s.tier === 3).length,
    freshSourceRatio: dated.length > 0 ? Math.round((dated.filter(isFresh).length / dated.length) * 1000) / 1000 : 0,
    evidenceQuality: computeEvidenceQuality(sources, candidateKeywords),
    contentOpportunity: {
      resultCount: 0,
      domainConcentration: domainConcentration(sources),
      shallowRatio: sources.length > 0 ? Math.round((sources.filter((s) => s.tier === 3).length / sources.length) * 1000) / 1000 : 0,
      hasAuthoritative: tier1Count > 0,
      // No SERP landscape -> opportunity is unknown, score neutral-low rather
      // than inflating it (the no-SERP path should not manufacture demand).
      opportunity: 40,
    },
  };
}

