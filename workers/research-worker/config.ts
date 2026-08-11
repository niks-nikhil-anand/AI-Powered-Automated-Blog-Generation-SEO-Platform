import { env } from "../shared/env";
import { ResearchSourceName } from "./types";

/**
 * Source -> whether it's enabled, driven by the ENABLE_* env flags. Order
 * matches the fixed order the old hardcoded array used, so behavior is
 * unchanged for anyone who hasn't touched these env vars (everything
 * defaults "true").
 */
const SOURCE_ENABLED: Record<ResearchSourceName, boolean> = {
  google_trends: env.ENABLE_GOOGLE_TRENDS,
  google_news: env.ENABLE_GOOGLE_NEWS,
  github_trending: env.ENABLE_GITHUB_TRENDING,
  techcrunch: env.ENABLE_TECHCRUNCH,
  the_verge: env.ENABLE_THE_VERGE,
  google_ai_blog: env.ENABLE_GOOGLE_AI_BLOG,
  openai_news: env.ENABLE_OPENAI_NEWS,
  anthropic_news: env.ENABLE_ANTHROPIC_NEWS,
  microsoft_ai_blog: env.ENABLE_MICROSOFT_AI_BLOG,
  nvidia_blog: env.ENABLE_NVIDIA_BLOG,
  hackernews: env.ENABLE_HACKERNEWS,
  // SearXNG discovery participates only when BOTH the master switch and the
  // per-source flag are on (see env.ts) - so it can never silently become a
  // discovery source, and it stays additive to the existing sources.
  searxng: env.SEARXNG_ENABLED && env.ENABLE_SEARXNG,
};

export const researchConfig = {
  enabledSources: (Object.keys(SOURCE_ENABLED) as ResearchSourceName[]).filter(
    (name) => SOURCE_ENABLED[name]
  ),
  region: env.GOOGLE_TRENDS_GEO,
  language: "en",
  newsLanguage: env.GOOGLE_NEWS_LANGUAGE,
  newsCountry: env.GOOGLE_NEWS_COUNTRY,
  maxSignalsPerSource: env.RESEARCH_MAX_SIGNALS_PER_SOURCE,
  minScoreToPromote: env.RESEARCH_MIN_SCORE_TO_PROMOTE,
  recentDuplicateDays: env.RESEARCH_RECENT_DUPLICATE_DAYS,
  /**
   * SearXNG client settings (docs/RESEARCH_ENGINE_UPGRADE.md Phase 2). Only
   * consulted when SEARXNG_ENABLED is on; see searxng/client.ts.
   */
  searxng: {
    enabled: env.SEARXNG_ENABLED,
    baseUrl: env.SEARXNG_BASE_URL,
    timeoutMs: env.SEARXNG_TIMEOUT_MS,
    resultsPerQuery: env.SEARXNG_RESULTS_PER_QUERY,
    maxQueries: env.SEARXNG_MAX_QUERIES,
    language: env.SEARXNG_LANGUAGE,
    categories: env.SEARXNG_CATEGORIES,
    engines: env.SEARXNG_ENGINES,
    safeSearch: env.SEARXNG_SAFESEARCH,
    timeRange: env.SEARXNG_TIME_RANGE,
    discoveryQueries: env.SEARXNG_DISCOVERY_QUERIES,
  },
  /**
   * Research-engine settings (docs/RESEARCH_ENGINE_UPGRADE.md). Only consulted
   * when RESEARCH_ENGINE_ENABLED is on; see pipeline/engine.ts.
   */
  engine: {
    enabled: env.RESEARCH_ENGINE_ENABLED,
    candidatePoolSize: env.RESEARCH_CANDIDATE_POOL_SIZE,
    maxQueriesPerCandidate: env.RESEARCH_MAX_QUERIES_PER_CANDIDATE,
    llmQueryExpansionEnabled: env.RESEARCH_LLM_QUERY_EXPANSION_ENABLED,
    llmTopicQualityEnabled: env.RESEARCH_LLM_TOPIC_QUALITY_ENABLED,
    llmNoveltyEnabled: env.RESEARCH_LLM_NOVELTY_ENABLED,
    embeddingEnabled: env.RESEARCH_EMBEDDING_ENABLED,
    noveltyLookbackDays: env.RESEARCH_NOVELTY_LOOKBACK_DAYS,
    noveltyMaxHistory: env.RESEARCH_NOVELTY_MAX_HISTORY,
    semanticSimilarityThreshold: env.RESEARCH_SEMANTIC_SIMILARITY_THRESHOLD,
    keywordSimilarityThreshold: env.RESEARCH_KEYWORD_SIMILARITY_THRESHOLD,
    freshnessVerySimilarDays: env.RESEARCH_FRESHNESS_VERY_SIMILAR_DAYS,
    freshnessHighlySimilarDays: env.RESEARCH_FRESHNESS_HIGHLY_SIMILAR_DAYS,
    freshnessSimilarDays: env.RESEARCH_FRESHNESS_SIMILAR_DAYS,
    tierExcellentScore: env.RESEARCH_TIER_EXCELLENT_SCORE,
    tierStrongScore: env.RESEARCH_TIER_STRONG_SCORE,
    dispatchMinScore: env.RESEARCH_DISPATCH_MIN_SCORE,
    minEvidenceScore: env.RESEARCH_MIN_EVIDENCE_SCORE,
    minNoveltyScore: env.RESEARCH_MIN_NOVELTY_SCORE,
    maxPerFamily: env.RESEARCH_MAX_PER_FAMILY,
    explorationRatio: env.RESEARCH_EXPLORATION_RATIO,
  },
  semanticEnabled: env.RESEARCH_SEMANTIC_ENABLED,
  semanticBatchSize: env.RESEARCH_SEMANTIC_BATCH_SIZE,
  semanticTimeoutMs: env.RESEARCH_SEMANTIC_TIMEOUT_MS,
  newsQuery: env.RESEARCH_GOOGLE_NEWS_QUERY,
  githubQueries: env.RESEARCH_GITHUB_QUERIES,
  /** Sent with every research-worker HTTP fetch - see workers/shared/env.ts's RESEARCH_USER_AGENT. */
  userAgent: env.RESEARCH_USER_AGENT,
  /** Defaults for workers/research-worker/utils/fetch-with-retry.ts - individual calls can still override. */
  fetchTimeoutMs: env.RESEARCH_TIMEOUT_MS,
  fetchRetryAttempts: env.RESEARCH_RETRY_COUNT,
  /** Per-source RSS feed URLs - see workers/shared/env.ts for defaults/verification notes. */
  sourceUrls: {
    googleAiBlog: env.GOOGLE_AI_BLOG_RSS,
    microsoftAiBlog: env.MICROSOFT_AI_BLOG_RSS,
    openaiNews: env.OPENAI_NEWS_RSS,
    anthropicNews: env.ANTHROPIC_NEWS_RSS,
    techcrunchAi: env.TECHCRUNCH_AI_RSS,
    techcrunchStartups: env.TECHCRUNCH_STARTUPS_RSS,
    theVergeAi: env.THE_VERGE_AI_RSS,
    nvidiaBlog: env.NVIDIA_BLOG_RSS,
    // No hackernews entry: hackernews.ts deliberately keeps using HN's
    // Firebase API (richer data - score, comment count - and it already
    // works) rather than switching to HACKERNEWS_RSS. That env var is still
    // defined and read in env.ts for anyone who wants it, just not
    // consumed here.
  },
  categories: [
    "AI",
    "Web Development",
    "Backend",
    "DevOps",
    "Databases",
    "Open Source",
    "General",
  ],
};
