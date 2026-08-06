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
