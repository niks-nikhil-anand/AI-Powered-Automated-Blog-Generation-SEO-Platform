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
  VERTEX_IMAGE_MODEL: optional("VERTEX_IMAGE_MODEL", "imagen-4.0-generate-001"),

  /**
   * Kill switch for real Imagen generation in image-worker (see
   * IMPLEMENTATION_PLAN.md's hero-image-quality addendum). Off falls back
   * to the pre-existing procedural SVG generator, same pattern as
   * RESEARCH_SEMANTIC_ENABLED below. Default on: at TRENDS_TO_WRITE_PER_RUN=5
   * x 3 runs/day, the worst case (every image collides on the uniqueness
   * check and retries 3x) is ~45 Imagen calls/day; imagen-4.0-generate-001
   * is billed per image (~$0.04 at standard tier as of Aug 2026), so that
   * ceiling is roughly $1.80/day even before any collisions are avoided.
   */
  IMAGE_AI_GENERATION_ENABLED: optional("IMAGE_AI_GENERATION_ENABLED", "true") !== "false",

  // Research worker
  GOOGLE_TRENDS_GEO: optional("GOOGLE_TRENDS_GEO", "US"),

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
  RESEARCH_MAX_SIGNALS_PER_SOURCE: Number(optional("RESEARCH_MAX_SIGNALS_PER_SOURCE", "25")),
  RESEARCH_MIN_SCORE_TO_PROMOTE: Number(optional("RESEARCH_MIN_SCORE_TO_PROMOTE", "70")),
  RESEARCH_MIN_SCORE_TO_WRITE: Number(optional("RESEARCH_MIN_SCORE_TO_WRITE", "90")),
  RESEARCH_RECENT_DUPLICATE_DAYS: Number(optional("RESEARCH_RECENT_DUPLICATE_DAYS", "30")),
  /** Kill switch for the Vertex semantic scoring/dedup pass - see pipeline/semantic.ts. Off falls back to the pre-existing heuristic-only score. */
  RESEARCH_SEMANTIC_ENABLED: optional("RESEARCH_SEMANTIC_ENABLED", "true") !== "false",
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

  /** Blogs/day the dashboard measures against. 3 slots x 1 topic per run. */
  DAILY_BLOG_TARGET: Number(optional("DAILY_BLOG_TARGET", "3")),

  // Writing worker
  BLOG_MIN_WORDS: Number(optional("BLOG_MIN_WORDS", "1200")),
  BLOG_MAX_WORDS: Number(optional("BLOG_MAX_WORDS", "2000")),

  // Image worker / AWS S3
  AWS_REGION: optional("AWS_REGION", "us-east-1"),
  AWS_ACCESS_KEY_ID: optional("AWS_ACCESS_KEY_ID", optional("AWS_ACCESS_KEY", "")),
  AWS_SECRET_ACCESS_KEY: optional("AWS_SECRET_ACCESS_KEY", optional("AWS_SECRET_KEY", "")),
  AWS_SESSION_TOKEN: required("AWS_SESSION_TOKEN"),
  AWS_S3_BUCKET: optional("AWS_S3_BUCKET", optional("AWS_BUCKET_NAME", "")),
  AWS_S3_PUBLIC_BASE_URL: optional("AWS_S3_PUBLIC_BASE_URL", optional("AWS_CLOUDFRONT_URL", "")),

  LOG_LEVEL: optional("LOG_LEVEL", "info"),
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
