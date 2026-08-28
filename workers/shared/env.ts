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

function numberInRange(name: string, fallback: number, min: number, max: number): number {
  const value = Number(optional(name, String(fallback)));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
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
   * Vertex call-level resilience (docs/VERTEX_429_RESILIENCE_PLAN.md
   * Tasks 7/9/10). Transient failures (429 RESOURCE_EXHAUSTED, 500/503,
   * local timeouts) retry in-call with exponential backoff + jitter so a
   * self-healing quota window never reaches the BullMQ job layer (which
   * retries the WHOLE job and amplifies quota burn).
   * VERTEX_MAX_CONCURRENT_CALLS caps parallel generate* calls across all
   * workers in the process (all workers share one process - one
   * module-level semaphore covers the actual contention point).
   * VERTEX_MODEL_FALLBACK_ENABLED lets the writing worker rerun a draft
   * on VERTEX_FLASH when the Pro-class model is persistently
   * quota-exhausted (logged loudly, never silently).
   */
  VERTEX_RETRY_MAX_ATTEMPTS: Number(optional("VERTEX_RETRY_MAX_ATTEMPTS", "5")),
  VERTEX_RETRY_BASE_MS: Number(optional("VERTEX_RETRY_BASE_MS", "30000")),
  VERTEX_RETRY_MAX_MS: Number(optional("VERTEX_RETRY_MAX_MS", "240000")),
  VERTEX_MAX_CONCURRENT_CALLS: Number(optional("VERTEX_MAX_CONCURRENT_CALLS", "6")),
  VERTEX_MODEL_FALLBACK_ENABLED: optional("VERTEX_MODEL_FALLBACK_ENABLED", "false") !== "false",

  /**
   * Cross-container quota pacing + circuit breaker
   * (docs/VERTEX_429_RESOLUTION_PLAN.md Steps 3-5). Workers run as separate
   * Docker containers, so an in-process semaphore can't coordinate them -
   * these Redis-backed controls can. RPM limits are PER MODEL CLASS
   * (Vertex quotas are per base model per region); defaults are
   * deliberately conservative - set them to ~80% of the real quotas from
   * the Cloud Console. VERTEX_RETRY_BUDGET_MS caps total retry wall-clock
   * per call so retry-stacking can't pin a job past BullMQ's lock
   * semantics. VERTEX_BREAKER_COOLDOWN_MS is how long deferrable calls
   * fail fast after a call exhausts all retries on quota.
   */
  VERTEX_FLASH_RPM: Number(optional("VERTEX_FLASH_RPM", "5")),
  VERTEX_PRO_RPM: Number(optional("VERTEX_PRO_RPM", "4")),
  VERTEX_IMAGE_RPM: Number(optional("VERTEX_IMAGE_RPM", "10")),
  VERTEX_RETRY_BUDGET_MS: Number(optional("VERTEX_RETRY_BUDGET_MS", "600000")),
  VERTEX_BREAKER_COOLDOWN_MS: Number(optional("VERTEX_BREAKER_COOLDOWN_MS", "120000")),
  VERTEX_BREAKER_MAX_COOLDOWN_MS: Number(optional("VERTEX_BREAKER_MAX_COOLDOWN_MS", "900000")),

  // Langfuse is initialized only by workers/vertex-gateway. These values are
  // kept server-side and must never be exposed through NEXT_PUBLIC_* vars.
  LANGFUSE_ENABLED: optional("LANGFUSE_ENABLED", "false") === "true",
  LANGFUSE_PUBLIC_KEY: required("LANGFUSE_PUBLIC_KEY"),
  LANGFUSE_SECRET_KEY: required("LANGFUSE_SECRET_KEY"),
  LANGFUSE_BASE_URL: optional("LANGFUSE_BASE_URL", "https://cloud.langfuse.com"),
  LANGFUSE_ENVIRONMENT: optional("LANGFUSE_ENVIRONMENT", optional("NODE_ENV", "development")),
  LANGFUSE_RELEASE: required("LANGFUSE_RELEASE"),
  LANGFUSE_SAMPLE_RATE: numberInRange("LANGFUSE_SAMPLE_RATE", 1, 0, 1),
  LANGFUSE_CAPTURE_PROMPTS: optional("LANGFUSE_CAPTURE_PROMPTS", "false") === "true",
  LANGFUSE_CAPTURE_OUTPUTS: optional("LANGFUSE_CAPTURE_OUTPUTS", "false") === "true",

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
  /** Daily Target Controller safety-net tick - see workers/shared/daily-target.ts. */
  RECONCILE_CRON: optional("RECONCILE_CRON", "*/30 * * * *"),
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
   * Full-text evidence ingestion (ENHANCEMENT_IMPLEMENTATION_PLAN.md Task 1).
   * Off = trends carry only the titles/URLs evidenceSummary, exactly as
   * before. On = promoted candidates also get up to EVIDENCE_MAX_ARTICLES
   * fetched article bodies (EVIDENCE_MAX_CHARS each) stored as
   * Trend.evidenceArticles for grounded writing/fact-checking downstream.
   */
  EVIDENCE_FETCH_ENABLED: optional("EVIDENCE_FETCH_ENABLED", "true") !== "false",
  EVIDENCE_MAX_ARTICLES: Number(optional("EVIDENCE_MAX_ARTICLES", "4")),
  EVIDENCE_MAX_CHARS: Number(optional("EVIDENCE_MAX_CHARS", "6000")),

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
  /**
   * SearXNG *discovery source* switch - the only ENABLE_* that defaults OFF,
   * since SearXNG is new and self-hosted (unlike the pre-existing sources that
   * ran unconditionally before flags existed). Only takes effect together with
   * SEARXNG_ENABLED (see the SearXNG block above).
   */
  ENABLE_SEARXNG: optional("ENABLE_SEARXNG", "false") !== "false",

  /** Blogs/day the dashboard measures against - and the number of publish slots (see workers/shared/publish-slots.ts). */
  DAILY_BLOG_TARGET: Number(optional("DAILY_BLOG_TARGET", "3")),

  /**
   * Minutes before a publish slot's target time that its pipeline fires
   * (generation lead). The quality-worker holds the finished blog (BullMQ
   * delay) until the slot's publish time; if retries run past it, the blog
   * publishes immediately instead. 30 min comfortably covers the measured
   * ~4-minute happy path plus a couple of stage retries.
   */
  SLOT_GENERATION_LEAD_MINUTES: Number(optional("SLOT_GENERATION_LEAD_MINUTES", "30")),

  /**
   * Retries AFTER the initial attempt for every pipeline stage job
   * (planning/outline/writing/image/quality/publish) and for the QA-failure
   * regeneration loop. This is only the env fallback - the live value is the
   * AppSetting "retryAttempts" edited in Settings (workers/shared/retry-config.ts).
   * BullMQ `attempts` = this + 1 (the initial try).
   */
  PIPELINE_RETRY_ATTEMPTS: Number(optional("PIPELINE_RETRY_ATTEMPTS", "3")),

  /**
   * SearXNG — optional self-hosted SERP discovery + validation layer
   * (docs/RESEARCH_ENGINE_UPGRADE.md). It is ADDITIVE: it never replaces the
   * existing trend/news/GitHub sources, and a SearXNG outage must never fail a
   * research run (every call fails soft to []). Two distinct flags:
   *   SEARXNG_ENABLED  - master switch for the SearXNG client (both the
   *                      discovery source AND the candidate research layer).
   *   ENABLE_SEARXNG   - per-source switch for SearXNG *discovery* only, same
   *                      pattern as the other ENABLE_* source flags.
   * Both default OFF, so out of the box nothing about research changes.
   */
  SEARXNG_ENABLED: optional("SEARXNG_ENABLED", "false") !== "false",
  /** Base URL of the self-hosted instance, e.g. http://localhost:8080 or the docker-compose `searxng` service. */
  SEARXNG_BASE_URL: optional("SEARXNG_BASE_URL", "http://localhost:8080"),
  SEARXNG_TIMEOUT_MS: Number(optional("SEARXNG_TIMEOUT_MS", "8000")),
  /** Results requested per query (SearXNG `format=json` returns up to this many). */
  SEARXNG_RESULTS_PER_QUERY: Number(optional("SEARXNG_RESULTS_PER_QUERY", "10")),
  /**
   * Hard budget on total SearXNG queries per research run across BOTH the
   * discovery source and the per-candidate research layer. Bounds added
   * latency and protects a shared/self-hosted instance from a runaway run.
   * Sized so a candidate pool can actually be researched (a handful of
   * discovery queries + a few per top candidate); once exhausted, remaining
   * candidates degrade to the offline evidence profile rather than failing.
   */
  SEARXNG_MAX_QUERIES: Number(optional("SEARXNG_MAX_QUERIES", "60")),
  SEARXNG_LANGUAGE: optional("SEARXNG_LANGUAGE", "en"),
  /** Comma-separated SearXNG categories (e.g. "general,it"). Empty = SearXNG default. */
  SEARXNG_CATEGORIES: optional("SEARXNG_CATEGORIES", "general"),
  /** Comma-separated SearXNG engines (e.g. "google,duckduckgo,github"). Empty = instance default. */
  SEARXNG_ENGINES: optional("SEARXNG_ENGINES", ""),
  /** Safe-search level: 0 (off) | 1 (moderate) | 2 (strict). */
  SEARXNG_SAFESEARCH: optional("SEARXNG_SAFESEARCH", "1"),
  /** Optional recency filter where the engine supports it: day|week|month|year. Empty = no filter. */
  SEARXNG_TIME_RANGE: optional("SEARXNG_TIME_RANGE", ""),
  /**
   * Comma-separated seed queries the SearXNG DISCOVERY source runs to surface
   * fresh developer content into the candidate pool. These are discovery
   * probes, distinct from the per-candidate expanded queries in Phase 3.
   */
  SEARXNG_DISCOVERY_QUERIES: optional(
    "SEARXNG_DISCOVERY_QUERIES",
    "new developer tools this week,AI coding agent announcement,open source LLM release,new JavaScript framework,developer productivity tool launch"
  )
    .split(",")
    .map((query) => query.trim())
    .filter(Boolean),

  /**
   * Research-engine master switch (docs/RESEARCH_ENGINE_UPGRADE.md). OFF =
   * runResearch() takes the legacy path byte-for-byte; ON = the novelty-driven
   * engine (large candidate pool, topic memory, topic/evidence quality,
   * transparent final score, diversity + exploration, structured run report).
   * Default OFF per the project's ship-dark convention.
   */
  RESEARCH_ENGINE_ENABLED: optional("RESEARCH_ENGINE_ENABLED", "false") !== "false",
  /**
   * How many candidates survive preliminary scoring into the SERP/evidence
   * research + final scoring stage. The engine deliberately evaluates far
   * more candidates than it ultimately dispatches (Phase 4) so "first topic
   * that cleared 90" is not the only discovery mechanism.
   */
  RESEARCH_CANDIDATE_POOL_SIZE: Number(optional("RESEARCH_CANDIDATE_POOL_SIZE", "40")),
  /** Cap on SearXNG research queries spent on a single candidate (Phase 3 budget). */
  RESEARCH_MAX_QUERIES_PER_CANDIDATE: Number(optional("RESEARCH_MAX_QUERIES_PER_CANDIDATE", "5")),
  /**
   * Optional LLM query expansion on top of the deterministic templates
   * (Phase 3). OFF = templates only (deterministic, zero cost). ON = one
   * batched Vertex call proposes a few extra intents per promising candidate.
   */
  RESEARCH_LLM_QUERY_EXPANSION_ENABLED:
    optional("RESEARCH_LLM_QUERY_EXPANSION_ENABLED", "false") !== "false",

  /**
   * Topic memory / novelty (Phases 5-6). How far back to compare candidates
   * against historical Trends + Blogs, and the similarity thresholds per
   * layer. RESEARCH_SEMANTIC_SIMILARITY_THRESHOLD is the cosine-similarity
   * cutoff for "same topic" on Gemini embeddings - the WORKER_ENHANCEMENT_GUIDE
   * R2 note recommends ~0.9; treat it as a starting point and calibrate against
   * real runs before tightening. Embeddings are Gemini text-embedding stored as
   * Trend.topicEmbedding (no new vector DB).
   */
  RESEARCH_NOVELTY_LOOKBACK_DAYS: Number(optional("RESEARCH_NOVELTY_LOOKBACK_DAYS", "90")),
  RESEARCH_SEMANTIC_SIMILARITY_THRESHOLD: Number(
    optional("RESEARCH_SEMANTIC_SIMILARITY_THRESHOLD", "0.9")
  ),
  /** Keyword-Jaccard similarity at/above which two titles are treated as the same topic. */
  RESEARCH_KEYWORD_SIMILARITY_THRESHOLD: Number(optional("RESEARCH_KEYWORD_SIMILARITY_THRESHOLD", "0.6")),
  /** Kill switch for the (paid) embedding calls in novelty scoring. OFF = novelty uses the free deterministic layers only. */
  RESEARCH_EMBEDDING_ENABLED: optional("RESEARCH_EMBEDDING_ENABLED", "true") !== "false",
  /** Freshness windows (days) - see pipeline/novelty.ts. */
  RESEARCH_FRESHNESS_VERY_SIMILAR_DAYS: Number(optional("RESEARCH_FRESHNESS_VERY_SIMILAR_DAYS", "7")),
  RESEARCH_FRESHNESS_HIGHLY_SIMILAR_DAYS: Number(optional("RESEARCH_FRESHNESS_HIGHLY_SIMILAR_DAYS", "30")),
  RESEARCH_FRESHNESS_SIMILAR_DAYS: Number(optional("RESEARCH_FRESHNESS_SIMILAR_DAYS", "90")),
  /** Optional LLM "is this a genuinely new development" check that lets a legitimate follow-up survive an entity match (Phase 6). OFF = deterministic version/update-signal heuristic only. */
  RESEARCH_LLM_NOVELTY_ENABLED: optional("RESEARCH_LLM_NOVELTY_ENABLED", "false") !== "false",

  /**
   * Optional LLM topic-quality score (Phase 7), batched like the semantic pass.
   * OFF = topic quality is the deterministic heuristic only. Either way it is
   * computed separately from raw trend strength so a viral-but-vague topic
   * cannot score well on trend signal alone.
   */
  RESEARCH_LLM_TOPIC_QUALITY_ENABLED: optional("RESEARCH_LLM_TOPIC_QUALITY_ENABLED", "false") !== "false",

  /**
   * Final selection (Phases 12-16). These are HONEST gates - the engine never
   * inflates a score to reach them (docs/RESEARCH_ENGINE_UPGRADE.md). A run
   * that finds too few genuine 90+ topics dispatches the best valid candidates
   * and records why the target was unmet instead of manufacturing points.
   */
  /** Tier cutoffs: >=RESEARCH_TIER_EXCELLENT_SCORE auto-dispatch eligible; >=RESEARCH_TIER_STRONG_SCORE strong/backlog. */
  RESEARCH_TIER_EXCELLENT_SCORE: Number(optional("RESEARCH_TIER_EXCELLENT_SCORE", "90")),
  RESEARCH_TIER_STRONG_SCORE: Number(optional("RESEARCH_TIER_STRONG_SCORE", "80")),
  /** Minimum final score a topic needs to be auto-dispatched to writing. */
  RESEARCH_DISPATCH_MIN_SCORE: Number(optional("RESEARCH_DISPATCH_MIN_SCORE", "90")),
  /** Hard minimums a dispatchable topic must clear regardless of total score. */
  RESEARCH_MIN_EVIDENCE_SCORE: Number(optional("RESEARCH_MIN_EVIDENCE_SCORE", "55")),
  RESEARCH_MIN_NOVELTY_SCORE: Number(optional("RESEARCH_MIN_NOVELTY_SCORE", "60")),
  /** Topic-family diversity: at most this many selected topics per family per run (Phase 14). */
  RESEARCH_MAX_PER_FAMILY: Number(optional("RESEARCH_MAX_PER_FAMILY", "2")),
  /** Fraction of the dispatch slot reserved for exploratory (emerging/niche) topics (Phase 15). */
  RESEARCH_EXPLORATION_RATIO: Number(optional("RESEARCH_EXPLORATION_RATIO", "0.2")),
  /** How many historical Trends/Blogs to load for novelty comparison (bounds memory + embedding work). */
  RESEARCH_NOVELTY_MAX_HISTORY: Number(optional("RESEARCH_NOVELTY_MAX_HISTORY", "400")),

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

  /**
   * Evidence-grounded writing (ENHANCEMENT_IMPLEMENTATION_PLAN.md Task 2).
   * On = the writing prompt receives full-text evidence sources keyed by
   * [S1]-style markers and citations are materialized deterministically in
   * code (workers/writing-worker/citations.ts). Off = legacy
   * titles-only evidenceSummary prompt + verbatim-URL citation check.
   * Requires the trend to actually have evidenceArticles (Task 1) - trends
   * without them always use the legacy path regardless of this flag.
   */
  GROUNDED_WRITING_ENABLED: optional("GROUNDED_WRITING_ENABLED", "true") !== "false",

  /**
   * Section-by-section writing + targeted repair (Task 5). Off = one
   * monolithic Pro draft per article, full rewrite on QA failure. On =
   * parallel Flash-class section generation assembled into the draft, and
   * QA failures carrying judgeFixes get a section-level splice repair
   * instead of a full rewrite. EDITOR_PASS_ENABLED adds a final Pro-class
   * cohesion pass over the assembled draft (measure value before enabling).
   */
  SECTIONED_WRITING_ENABLED: optional("SECTIONED_WRITING_ENABLED", "true") !== "false",
  TARGETED_REPAIR_ENABLED: optional("TARGETED_REPAIR_ENABLED", "true") !== "false",
  EDITOR_PASS_ENABLED: optional("EDITOR_PASS_ENABLED", "false") !== "false",
  WRITING_SECTION_CONCURRENCY: Number(optional("WRITING_SECTION_CONCURRENCY", "3")),

  /**
   * Write-time claim self-check + claim-aware repair
   * (docs/WRITING_FACT_SAFETY_PLAN.md Task 6). On = after drafting, every
   * deterministic claim is verified against the same evidence the quality
   * worker's fact check will use; claims that would be blocked at QA are
   * repaired section-by-section before the draft is persisted, and the
   * writing gate fails with the concrete claim list when repair can't fix
   * them (so the BullMQ retry's priorAttempt carries specifics).
   * WRITING_SELFCHECK_MAX_REPAIR_PASSES bounds the section-repair loop
   * (one qualitative full redraft may follow, then the gate decides).
   * WRITING_CLAIM_MARKER_ENFORCEMENT adds the zero-cost deterministic
   * check that every specific claim carries its [S]-marker (grounded mode
   * only). All fail-soft: a self-check that can't run changes nothing.
   */
  WRITING_SELFCHECK_ENABLED: optional("WRITING_SELFCHECK_ENABLED", "true") !== "false",
  WRITING_SELFCHECK_MAX_REPAIR_PASSES: Number(optional("WRITING_SELFCHECK_MAX_REPAIR_PASSES", "2")),
  WRITING_CLAIM_MARKER_ENFORCEMENT: optional("WRITING_CLAIM_MARKER_ENFORCEMENT", "true") !== "false",

  /**
   * Quality worker upgrades (Tasks 3 & 4).
   * FULL_FACTCHECK_ENABLED: claim-level verification of every extracted
   *   claim against full-text evidence (falls back to the legacy sampled
   *   check when the trend has no evidenceArticles).
   * JUDGE_ENABLED: holistic LLM editorial judge as a weighted 12th check.
   * JUDGE_SHADOW_MODE: compute + persist the judge result but DON'T let it
   *   affect pass/fail - mandatory calibration mode before going live.
   * JUDGE_WEIGHT: weight of the judge score in overallScore (rest is the
   *   existing heuristic checks' average).
   * DIMENSION_FLOOR: minimum per-check score (of 10) - one collapsed
   *   dimension can no longer be averaged into a pass.
   */
  FULL_FACTCHECK_ENABLED: optional("FULL_FACTCHECK_ENABLED", "true") !== "false",
  JUDGE_ENABLED: optional("JUDGE_ENABLED", "false") !== "false",
  JUDGE_SHADOW_MODE: optional("JUDGE_SHADOW_MODE", "true") !== "false",
  JUDGE_WEIGHT: Number(optional("JUDGE_WEIGHT", "0.25")),
  DIMENSION_FLOOR: Number(optional("DIMENSION_FLOOR", "6")),

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
 * Whether a worker can route Vertex work to the gateway. Workers have no
 * Google SDK client and intentionally do not receive a credential file.
 * Gateway credential readiness is checked separately below.
 */
/**
 * Workers only need enough configuration to route a request to the gateway.
 * They deliberately do not require Google credentials: those credentials must
 * exist only in the vertex-gateway container.
 */
export const isVertexConfigured = Boolean(env.GOOGLE_CLOUD_PROJECT && env.VERTEX_LOCATION);

/** The gateway is the sole process that needs local Google credentials. */
export const isVertexGatewayConfigured = Boolean(
  env.GOOGLE_CLOUD_PROJECT && env.VERTEX_LOCATION && env.GOOGLE_APPLICATION_CREDENTIALS
);

export const isS3Configured = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_S3_BUCKET);
