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

  // Research worker
  GOOGLE_TRENDS_GEO: optional("GOOGLE_TRENDS_GEO", "US"),
  RESEARCH_CRON: optional("RESEARCH_CRON", "0 8 * * *"), // 8:00 AM daily
  TIMEZONE: optional("TIMEZONE", "Asia/Kolkata"),
  TRENDS_TO_WRITE_PER_RUN: Number(optional("TRENDS_TO_WRITE_PER_RUN", "5")),
  RESEARCH_MAX_SIGNALS_PER_SOURCE: Number(optional("RESEARCH_MAX_SIGNALS_PER_SOURCE", "25")),
  RESEARCH_MIN_SCORE_TO_PROMOTE: Number(optional("RESEARCH_MIN_SCORE_TO_PROMOTE", "70")),
  RESEARCH_RECENT_DUPLICATE_DAYS: Number(optional("RESEARCH_RECENT_DUPLICATE_DAYS", "30")),
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

  // Writing worker
  BLOG_MIN_WORDS: Number(optional("BLOG_MIN_WORDS", "1200")),
  BLOG_MAX_WORDS: Number(optional("BLOG_MAX_WORDS", "2000")),

  // Image worker / AWS S3
  AWS_REGION: optional("AWS_REGION", "us-east-1"),
  AWS_ACCESS_KEY_ID: required("AWS_ACCESS_KEY_ID"),
  AWS_SECRET_ACCESS_KEY: required("AWS_SECRET_ACCESS_KEY"),
  AWS_SESSION_TOKEN: required("AWS_SESSION_TOKEN"),
  AWS_S3_BUCKET: required("AWS_S3_BUCKET"),
  AWS_S3_PUBLIC_BASE_URL: required("AWS_S3_PUBLIC_BASE_URL"),

  LOG_LEVEL: optional("LOG_LEVEL", "info"),
};

/**
 * Whether Vertex AI has the required routing config. Authentication is handled
 * by Google ADC/service-account credentials, usually via
 * GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`.
 */
export const isVertexConfigured = Boolean(env.GOOGLE_CLOUD_PROJECT && env.VERTEX_LOCATION);

export const isS3Configured = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_S3_BUCKET);
