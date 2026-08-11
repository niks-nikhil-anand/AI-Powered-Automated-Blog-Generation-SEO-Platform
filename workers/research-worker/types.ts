export type ResearchSourceName =
  | "google_trends"
  | "google_news"
  | "github_trending"
  | "techcrunch"
  | "the_verge"
  | "google_ai_blog"
  | "openai_news"
  | "anthropic_news"
  | "microsoft_ai_blog"
  | "nvidia_blog"
  | "hackernews"
  | "searxng";

export type RawSignal = {
  source: ResearchSourceName;
  title: string;
  url?: string;
  description?: string;
  snippet?: string;
  publishedAt?: Date;
  timestamp?: string;
  volume?: number;
  engagement?: number;
  tags?: string[];
  raw?: unknown;
};

export type NormalizedSignal = RawSignal & {
  normalizedTitle: string;
  slug: string;
  keywords: string[];
  category: string;
  fingerprint: string;
};

export type ResearchCandidate = {
  title: string;
  slug: string;
  category: string;
  score: number;
  priority: "high" | "medium" | "low";
  reason: string;
  keywords: string[];
  evidence: NormalizedSignal[];
  scoreBreakdown: {
    trendDemand: number;
    newsFreshness: number;
    githubMomentum: number;
    multiSourceValidation: number;
    /**
     * LLM-derived "is this actually a good blog topic" score (see
     * pipeline/semantic.ts). 0 when semantic scoring was skipped or failed,
     * not when the model judged it irrelevant - check scoreBreakdown against
     * RESEARCH_SEMANTIC_ENABLED / Vertex config if that distinction matters.
     */
    semanticRelevance: number;
  };
};

export type ResearchSource = {
  name: ResearchSourceName;
  displayName?: string;
  fetch?: () => Promise<RawSignal[]>;
  fetchSignals?: () => Promise<RawSignal[]>;
};

/* --------------------------------------------------------------------------
 * Research-engine types (docs/RESEARCH_ENGINE_UPGRADE.md). Everything below is
 * additive - the legacy path never touches it, and these shapes only appear on
 * rows produced while RESEARCH_ENGINE_ENABLED is on.
 * ------------------------------------------------------------------------ */

/** Search intent for an expanded query (Phase 3). */
export type QueryIntent =
  | "DISCOVERY"
  | "OFFICIAL"
  | "TECHNICAL"
  | "GITHUB"
  | "DOCUMENTATION"
  | "BENCHMARK"
  | "COMMUNITY"
  | "ALTERNATIVE";

/** One expanded query with its intent and where it came from (provenance). */
export type ExpandedQuery = {
  query: string;
  intent: QueryIntent;
  /** "template" = deterministic, "llm" = Vertex-proposed. */
  origin: "template" | "llm";
};

/** One SERP result returned by the SearXNG client (normalized across engines). */
export type SerpResult = {
  title: string;
  url: string;
  snippet?: string;
  engine?: string;
  category?: string;
  /** ISO date when the engine provides one. */
  publishedDate?: string;
  /** SearXNG's own per-result score, when present. */
  score?: number;
};

/** A SERP result after source-tiering (Phase 8). */
export type TieredSource = SerpResult & {
  domain: string;
  /** 1 = official/primary, 2 = reputable technical press, 3 = community/aggregator. */
  tier: 1 | 2 | 3;
};

/**
 * Evidence-gathering outcome for one candidate (Phases 8-10). All counts are
 * derived deterministically from the tiered source set.
 */
export type EvidenceProfile = {
  sources: TieredSource[];
  totalSources: number;
  independentDomains: number;
  /** Count of Tier-1 (official/primary) sources. */
  primarySources: number;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  /** Share of sources whose publishedDate is within the freshness window. */
  freshSourceRatio: number;
  /** Evidence-quality sub-scores and total (Phase 9). */
  evidenceQuality: {
    completeness: number;
    authority: number;
    diversity: number;
    freshness: number;
    relevance: number;
    total: number;
  };
  /** Content-gap / landscape analysis (Phase 10). */
  contentOpportunity: {
    resultCount: number;
    /** Herfindahl concentration of domains 0..1 (1 = one domain dominates). */
    domainConcentration: number;
    /** Fraction of results judged shallow (forums/listicles/aggregators). */
    shallowRatio: number;
    /** Whether official/docs results exist to ground an article. */
    hasAuthoritative: boolean;
    /** 0..100 - high when demand+evidence strong but existing content weak. */
    opportunity: number;
  };
};

/** Topic-quality sub-scores (Phase 7), each 0..100, plus the weighted total. */
export type TopicQuality = {
  specificity: number;
  technicalDepth: number;
  informationRichness: number;
  developerRelevance: number;
  explainerPotential: number;
  evergreenValue: number;
  practicalUsefulness: number;
  /** Optional LLM topic-quality score; 0 when disabled/unavailable. */
  llmQuality: number;
  total: number;
};

/** Which novelty layer produced the strongest historical match (Phase 5). */
export type NoveltyLayer =
  | "exact_title"
  | "canonical_url"
  | "fingerprint"
  | "keyword"
  | "embedding"
  | "entity"
  | "published"
  | "none";

/** Topic-memory verdict for one candidate (Phases 5-6). */
export type NoveltyVerdict = {
  /** 0..100 - 100 means no meaningful historical overlap. */
  noveltyScore: number;
  /** Strongest similarity found against history, 0..1. */
  maxSimilarity: number;
  layer: NoveltyLayer;
  /** The historical topic/blog this candidate most resembles, if any. */
  matchedTopic?: string;
  matchedAt?: string;
  /** Age of the closest match in days (for freshness windows). */
  matchedAgeDays?: number;
  /** Freshness-window decision: reject / penalize / allow. */
  decision: "reject" | "penalize" | "allow";
  /** True when a legitimate "new development" override fired (Phase 6). */
  newDevelopment: boolean;
  reason: string;
};

/** Topic family for diversity capping (Phase 14). */
export type TopicFamily =
  | "AI"
  | "Developer Tools"
  | "Cloud"
  | "Open Source"
  | "Security"
  | "Databases"
  | "Frontend"
  | "Backend"
  | "DevOps"
  | "Programming Languages"
  | "Frameworks"
  | "Infrastructure"
  | "General";

/** Transparent final score (Phase 11). Each dimension 0..100, weighted to /100. */
export type FinalScoreBreakdown = {
  trendDemand: number;
  freshness: number;
  searchDemand: number;
  githubMomentum: number;
  sourceDiversity: number;
  evidenceQuality: number;
  topicQuality: number;
  novelty: number;
  audienceValue: number;
  /** Weighted total, 0..100. Never artificially raised (Phase 12). */
  final: number;
};

/** Quality tier from the honest tiering system (Phase 12). */
export type ScoreTier = "excellent" | "strong" | "weak" | "reject";

/** A candidate that has been fully enriched by the engine. */
export type EngineCandidate = {
  candidate: ResearchCandidate;
  canonicalUrl?: string;
  topicFingerprint: string;
  embedding?: number[];
  queries: ExpandedQuery[];
  evidenceProfile: EvidenceProfile;
  topicQuality: TopicQuality;
  novelty: NoveltyVerdict;
  family: TopicFamily;
  exploratory: boolean;
  finalScore: FinalScoreBreakdown;
  tier: ScoreTier;
};

/** Persisted onto Trend.researchDetail (JSON) for engine-produced trends. */
export type ResearchDetail = {
  engine: true;
  finalScore: FinalScoreBreakdown;
  tier: ScoreTier;
  family: TopicFamily;
  exploratory: boolean;
  novelty: NoveltyVerdict;
  topicQuality: TopicQuality;
  evidenceQuality: EvidenceProfile["evidenceQuality"];
  contentOpportunity: EvidenceProfile["contentOpportunity"];
  /** Query provenance for observability (Phase 3). */
  queries: ExpandedQuery[];
  /** Compact source list for downstream grounding/citation. */
  sources: { url: string; title: string; domain: string; tier: 1 | 2 | 3 }[];
};

/** Structured per-run report (Phase 17) persisted to the ResearchRun table. */
export type ResearchRunReport = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  engine: true;
  // Funnel
  rawCandidates: number;
  normalized: number;
  semanticClusters: number;
  poolSize: number;
  // Rejection buckets (Phase 13)
  exactDuplicatesRemoved: number;
  semanticDuplicatesRemoved: number;
  historicalDuplicatesRemoved: number;
  freshnessRejected: number;
  lowQualityRejected: number;
  insufficientEvidenceRejected: number;
  lowNoveltyRejected: number;
  // SERP usage
  serpQueries: number;
  serpResults: number;
  uniqueDomains: number;
  // Outcomes
  candidatesGte80: number;
  candidatesGte90: number;
  selectedCount: number;
  avgFinalScore: number;
  avgNovelty: number;
  avgEvidenceQuality: number;
  // Diversity (Phase 14)
  topicFamilies: Record<string, number>;
  explorationCount: number;
  // Dispatch outcome + reason the target was/wasn't met (Phase 12/13)
  dispatchTarget: number;
  dispatched: number;
  outcome: "ok" | "insufficient_qualified" | "no_new_topics" | "all_sources_failed";
  outcomeReason: string;
  failedSources: string[];
};
