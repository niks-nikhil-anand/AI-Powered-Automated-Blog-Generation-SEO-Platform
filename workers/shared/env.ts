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

  // Vertex AI / GCP
  GOOGLE_CLOUD_PROJECT: required("GOOGLE_CLOUD_PROJECT"),
  GOOGLE_APPLICATION_CREDENTIALS: required("GOOGLE_APPLICATION_CREDENTIALS"),
  VERTEX_LOCATION: optional("VERTEX_LOCATION", "us-central1"),
  VERTEX_MODEL: optional("VERTEX_MODEL", "gemini-2.5-pro"),
  VERTEX_FLASH: optional("VERTEX_FLASH", "gemini-2.5-flash"),

  // Research worker
  GOOGLE_TRENDS_GEO: optional("GOOGLE_TRENDS_GEO", "US"),
  RESEARCH_CRON: optional("RESEARCH_CRON", "0 8 * * *"), // 8:00 AM daily
  TIMEZONE: optional("TIMEZONE", "Asia/Kolkata"),
  TRENDS_TO_WRITE_PER_RUN: Number(optional("TRENDS_TO_WRITE_PER_RUN", "5")),

  // Writing worker
  BLOG_MIN_WORDS: Number(optional("BLOG_MIN_WORDS", "1200")),
  BLOG_MAX_WORDS: Number(optional("BLOG_MAX_WORDS", "2000")),

  LOG_LEVEL: optional("LOG_LEVEL", "info"),
};

/**
 * Whether real Vertex AI credentials are configured. When false, the
 * writing-worker falls back to a deterministic mock generator so the
 * research -> writing -> Postgres pipeline can still be exercised
 * end-to-end before real GCP credentials exist.
 */
export const isVertexConfigured = Boolean(
  env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_APPLICATION_CREDENTIALS
);
