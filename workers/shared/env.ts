/**
 * Centralized, typed access to environment variables used by the worker
 * processes (research-worker, writing-worker, scheduler).
 *
 * Loads `.env` via dotenv so standalone `tsx workers/...` scripts see the
 * same values Next.js loads automatically for the web app.
 */
import "dotenv/config";

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function required(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "",

  REDIS_URL: optional("REDIS_URL", "redis://localhost:6379"),

  // Google Vertex AI via Google Gen AI SDK.
  // This intentionally does not use GEMINI_API_KEY / VERTEX_API_KEY because
  // API-key clients hit the AI Studio Gemini endpoint, not Vertex AI billing.
  GOOGLE_CLOUD_PROJECT: required("GOOGLE_CLOUD_PROJECT"),
  GOOGLE_APPLICATION_CREDENTIALS: required("GOOGLE_APPLICATION_CREDENTIALS"),
  VERTEX_LOCATION: optional("VERTEX_LOCATION", optional("GOOGLE_CLOUD_LOCATION", "us-central1")),
  VERTEX_MODEL: optional("VERTEX_MODEL", "gemini-2.5-pro"),
  VERTEX_FLASH: optional("VERTEX_FLASH", "gemini-2.5-flash"),
  VERTEX_IMAGE_MODEL: optional("VERTEX_IMAGE_MODEL", "gemini-2.5-flash-image"),

  /**
   * Kill switch for real AI hero-image generation in image-worker (see
   * IMPLEMENTATION_PLAN.md's hero-image-quality addendum). Off falls back
   * to the pre-existing procedural SVG generator, same pattern as
   * RESEARCH_SEMANTIC_ENABLED below. Default on: at TRENDS_TO_WRITE_PER_RUN=5
   * x 3 runs/day, the worst case (every image collides on the uniqueness
   * check and retries 3x) is ~45 image-generation calls/day against
   * VERTEX_IMAGE_MODEL (gemini-2.5-flash-image), billed per generated image.
   */
  IMAGE_AI_GENERATION_ENABLED: optional("IMAGE_AI_GENERATION_ENABLED", "true") !== "false",

  // Research worker
  GOOGLE_TRENDS_GEO: optional("GOOGLE_TRENDS_GEO", "US"),
  /** Locale for Google News RSS's hl/gl/ceid params - independent of GOOGLE_TRENDS_GEO since a deployment may want different trends-region vs. news-locale. */
  GOOGLE_NEWS_LANGUAGE: optional("GOOGLE_NEWS_LANGUAGE", "en"),
  GOOGLE_NEWS_COUNTRY: optional("GOOGLE_NEWS_COUNTRY", "US"),

  /**
   * Three research slots per day, tuned so each lands on the news cycle it is
   * named for (see SCHEDULING_PLAN.md). Times are in TIMEZONE.
   *
   *   06:30 IST = 17:00 PT (-1d) - sweeps the whole previous US working day
   *   14:00 IST = 09:30 CET     - EU morning desk, Asia afternoon
   *   23:30 IST = 10:00 PT      - peak US product-launch hour
   */
  RESEARCH_CRON_OVERNIGHT: optional("RESEARCH_CRON_OVERNIGHT", "30 6 * * *"),
  RESEARCH_CRON_MIDDAY: optional("RESEARCH_CRON_MIDDAY", "0 14 * * *"),
  RESEARCH_CRON_US_DAYTIME: optional("RESEARCH_CRON_US_DAYTIME", "30 23 * * *"),
  /** @deprecated Superseded by the three RESEARCH_CRON_* slots. */
  RESEARCH_CRON: required("RESEARCH_CRON"),
  /** Only the process with this set registers job schedulers. */
  SCHEDULER_ENABLED: optional("SCHEDULER_ENABLED", "true") !== "false",
  TIMEZONE: optional("TIMEZONE", "Asia/Kolkata"),
  TRENDS_TO_WRITE_PER_RUN: Number(optional("TRENDS_TO_WRITE_PER_RUN", "5")),
  /** RESEARCH_MAX_ARTICLES_PER_SOURCE is the newer/preferred name; RESEARCH_MAX_SIGNALS_PER_SOURCE stays supported since docker-compose.yml already sets it. */
  RESEARCH_MAX_SIGNALS_PER_SOURCE: Number(
    optional("RESEARCH_MAX_ARTICLES_PER_SOURCE", optional("RESEARCH_MAX_SIGNALS_PER_SOURCE", "25"))
  ),
  RESEARCH_MIN_SCORE_TO_PROMOTE: Number(optional("RESEARCH_MIN_SCORE_TO_PROMOTE", "70")),
  /** RESEARCH_WRITE_THRESHOLD is the newer/preferred name; RESEARCH_MIN_SCORE_TO_WRITE stays supported for the same reason. */
  RESEARCH_MIN_SCORE_TO_WRITE: Number(
    optional("RESEARCH_WRITE_THRESHOLD", optional("RESEARCH_MIN_SCORE_TO_WRITE", "90"))
  ),
  RESEARCH_RECENT_DUPLICATE_DAYS: Number(optional("RESEARCH_RECENT_DUPLICATE_DAYS", "30")),
  /** Kill switch for the Vertex semantic scoring/dedup pass - see pipeline/semantic.ts. Off falls back to the pre-existing heuristic-only score. */
  RESEARCH_SEMANTIC_ENABLED: optional("RESEARCH_SEMANTIC_ENABLED", "true") !== "false",
  /**
   * Clusters per Vertex call in the semantic pass, run in parallel batches
   * instead of one request holding every cluster from the run (which used
   * to time out past ~30s once a run had 100+ clusters, discarding semantic
   * scores for all of them at once). 10-20 is the sweet spot: small enough
   * to finish well inside the timeout, big enough that duplicate detection
   * (which only works within a batch, not across batches) still has real
   * candidates to compare.
   */
  RESEARCH_SEMANTIC_BATCH_SIZE: Number(optional("RESEARCH_SEMANTIC_BATCH_SIZE", "15")),
  /** Per-batch timeout for the semantic pass - separate from Vertex's other 30s default since this call scales with batch size. */
  RESEARCH_SEMANTIC_TIMEOUT_MS: Number(optional("RESEARCH_SEMANTIC_TIMEOUT_MS", "45000")),
  RESEARCH_GOOGLE_NEWS_QUERY: optional(
    "RESEARCH_GOOGLE_NEWS_QUERY",
    "developer tools OR javascript OR typescript OR ai coding OR open source"
  ),
  RESEARCH_GITHUB_QUERIES: optional(
    "RESEARCH_GITHUB_QUERIES",
    "created:>2026-07-01 stars:>100 language:TypeScript,created:>2026-07-01 stars:>100 language:JavaScript,created:>2026-07-01 stars:>100 language:Python"
  )
    .split(",")
    .map((query) => query.trim())
    .filter(Boolean),

  /**
   * Research source RSS feeds - each independently overridable, defaulting
   * to a feed URL actually verified live (curl HTTP 200) at the time this
   * was wired up. Some of the *previous* hardcoded defaults had gone dead
   * (feed.techcrunch.com no longer resolves, openai.com/feed.xml 403s,
   * ai.googleblog.com/feeds/posts/default 404s - Google moved that blog) and
   * were failing silently every research run. ANTHROPIC_NEWS_RSS is the one
   * exception: anthropic.com/research/rss.xml also 404s and no working
   * replacement RSS feed could be found - it stays broken until a real URL
   * is available, degrading to 0 signals from that source (handled the same
   * as any other source failure, not fatal to the research run).
   */
  GOOGLE_AI_BLOG_RSS: optional("GOOGLE_AI_BLOG_RSS", "https://blog.google/technology/ai/rss/"),
  MICROSOFT_AI_BLOG_RSS: optional("MICROSOFT_AI_BLOG_RSS", "https://www.microsoft.com/en-us/research/feed/"),
  OPENAI_NEWS_RSS: optional("OPENAI_NEWS_RSS", "https://openai.com/news/rss.xml"),
  ANTHROPIC_NEWS_RSS: optional("ANTHROPIC_NEWS_RSS", "https://www.anthropic.com/research/rss.xml"),
  TECHCRUNCH_AI_RSS: optional("TECHCRUNCH_AI_RSS", "https://techcrunch.com/category/artificial-intelligence/feed/"),
  TECHCRUNCH_STARTUPS_RSS: optional("TECHCRUNCH_STARTUPS_RSS", "https://techcrunch.com/category/startups/feed/"),
  THE_VERGE_AI_RSS: optional("THE_VERGE_AI_RSS", "https://www.theverge.com/rss/ai/index.xml"),
  NVIDIA_BLOG_RSS: optional("NVIDIA_BLOG_RSS", "https://blogs.nvidia.com/feed/"),
  HACKERNEWS_RSS: optional("HACKERNEWS_RSS", "https://hnrss.org/frontpage"),

  /** workers/research-worker/utils/fetch-with-retry.ts's defaults - were hardcoded (15000ms / 2 attempts) with no env override before this. */
  RESEARCH_TIMEOUT_MS: Number(optional("RESEARCH_TIMEOUT_MS", "15000")),
  RESEARCH_RETRY_COUNT: Number(optional("RESEARCH_RETRY_COUNT", "2")),
  /** Sent with every research-worker HTTP fetch. Was previously hardcoded per-source with slightly inconsistent strings; now one shared value. */
  RESEARCH_USER_AGENT: optional("RESEARCH_USER_AGENT", "Mozilla/5.0 (compatible; AutoBlogResearchBot/1.0)"),

  /**
   * Per-source on/off switches. All default "true" since every source ran
   * unconditionally before these existed - workers/research-worker/config.ts
   * computes `enabledSources` from these instead of a hardcoded array.
   */
  ENABLE_GOOGLE_TRENDS: optional("ENABLE_GOOGLE_TRENDS", "true") !== "false",
  ENABLE_GOOGLE_NEWS: optional("ENABLE_GOOGLE_NEWS", "true") !== "false",
  ENABLE_GITHUB_TRENDING: optional("ENABLE_GITHUB_TRENDING", "true") !== "false",
  ENABLE_TECHCRUNCH: optional("ENABLE_TECHCRUNCH", "true") !== "false",
  ENABLE_THE_VERGE: optional("ENABLE_THE_VERGE", "true") !== "false",
  ENABLE_GOOGLE_AI_BLOG: optional("ENABLE_GOOGLE_AI_BLOG", "true") !== "false",
  ENABLE_OPENAI_NEWS: optional("ENABLE_OPENAI_NEWS", "true") !== "false",
  ENABLE_ANTHROPIC_NEWS: optional("ENABLE_ANTHROPIC_NEWS", "true") !== "false",
  ENABLE_MICROSOFT_AI_BLOG: optional("ENABLE_MICROSOFT_AI_BLOG", "true") !== "false",
  ENABLE_NVIDIA_BLOG: optional("ENABLE_NVIDIA_BLOG", "true") !== "false",
  ENABLE_HACKERNEWS: optional("ENABLE_HACKERNEWS", "true") !== "false",

  /** Blogs/day the dashboard measures against. 3 slots x 1 topic per run. */
  DAILY_BLOG_TARGET: Number(optional("DAILY_BLOG_TARGET", "3")),

  // Writing worker
  BLOG_MIN_WORDS: Number(optional("BLOG_MIN_WORDS", "1200")),
  BLOG_MAX_WORDS: Number(optional("BLOG_MAX_WORDS", "2000")),
  /**
   * generateVertexText's call in writing-worker was stuck on
   * withVertexTimeout's generic 30s default - fine for planning/outline's
   * short JSON responses, not for an up-to-8192-token full article draft.
   * Own timeout, same pattern as RESEARCH_SEMANTIC_TIMEOUT_MS.
   */
  WRITING_TIMEOUT_MS: Number(optional("WRITING_TIMEOUT_MS", "120000")),

  // Image worker / AWS S3
  AWS_REGION: optional("AWS_REGION", "us-east-1"),
  AWS_ACCESS_KEY_ID: optional("AWS_ACCESS_KEY_ID", optional("AWS_ACCESS_KEY", "")),
  AWS_SECRET_ACCESS_KEY: optional("AWS_SECRET_ACCESS_KEY", optional("AWS_SECRET_KEY", "")),
  AWS_SESSION_TOKEN: required("AWS_SESSION_TOKEN"),
  AWS_S3_BUCKET: optional("AWS_S3_BUCKET", optional("AWS_BUCKET_NAME", "")),
  AWS_S3_PUBLIC_BASE_URL: optional("AWS_S3_PUBLIC_BASE_URL", optional("AWS_CLOUDFRONT_URL", "")),

  LOG_LEVEL: optional("LOG_LEVEL", "info"),
  /** How long LogEntry rows survive before workers/shared/log-transport.ts prunes them. */
  LOG_RETENTION_DAYS: Number(optional("LOG_RETENTION_DAYS", "14")),
};

/**
 * Whether Vertex AI has the required routing config. Requires
 * GOOGLE_APPLICATION_CREDENTIALS explicitly rather than just
 * project+location, so a deployment that forgot to mount the service-account
 * key fails the "is Vertex usable" check instead of silently falling back to
 * every worker's mock/procedural path. Known gap (see
 * IMPLEMENTATION_PLAN.md Phase 1.3): this still can't detect
 * `gcloud auth application-default login`-style ADC, where there's no env
 * var at all and credentials live in a well-known local file. A fully
 * correct check would attempt a lightweight authenticated call at startup
 * and cache the result - that's real work and stays a backlog follow-up.
 */
export const isVertexConfigured = Boolean(
  env.GOOGLE_CLOUD_PROJECT && env.VERTEX_LOCATION && env.GOOGLE_APPLICATION_CREDENTIALS
);

export const isS3Configured = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_S3_BUCKET);
