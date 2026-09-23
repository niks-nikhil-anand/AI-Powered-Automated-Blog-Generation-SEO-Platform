/**
 * Centralized, typed access to environment variables used by the worker
 * processes (scheduler, planning, outline, writing, image, quality, publish).
 *
 * Loads `.env` via dotenv so standalone `tsx workers/...` scripts see the
 * same values Next.js loads automatically for the web app.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

// Materialize Google Application Credentials JSON from individual env vars if the file is missing.
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialsPath && !fs.existsSync(credentialsPath)) {
  const hasFields =
    process.env.GCP_TYPE &&
    process.env.GCP_PROJECT_ID &&
    process.env.GCP_PRIVATE_KEY_ID &&
    process.env.GCP_PRIVATE_KEY &&
    process.env.GCP_CLIENT_EMAIL &&
    process.env.GCP_CLIENT_ID;

  if (hasFields) {
    try {
      const parentDir = path.dirname(credentialsPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      const saObject = {
        type: process.env.GCP_TYPE,
        project_id: process.env.GCP_PROJECT_ID,
        private_key_id: process.env.GCP_PRIVATE_KEY_ID,
        private_key: process.env.GCP_PRIVATE_KEY!.replace(/\\n/g, "\n"),
        client_email: process.env.GCP_CLIENT_EMAIL,
        client_id: process.env.GCP_CLIENT_ID,
        auth_uri: process.env.GCP_AUTH_URI,
        token_uri: process.env.GCP_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.GCP_AUTH_PROVIDER_X509_CERT_URL,
        client_x509_cert_url: process.env.GCP_CLIENT_X509_CERT_URL,
        universe_domain: process.env.GCP_UNIVERSE_DOMAIN,
      };
      fs.writeFileSync(credentialsPath, JSON.stringify(saObject, null, 2));
      console.log(`[Auto-Auth] Materialized service account JSON to ${credentialsPath}`);
    } catch (err) {
      console.error(`[Auto-Auth] Failed to write credentials file to ${credentialsPath}:`, err);
    }
  }
}

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
  /**
   * The gateway can overlap slow network/model responses. Per-model RPM
   * pacing still happens in Redis before every call, so this improves
   * throughput without raising the configured Vertex quota demand.
   */
  VERTEX_GATEWAY_CONCURRENCY: Number(optional("VERTEX_GATEWAY_CONCURRENCY", "2")),

  /**
   * Kill switch for real AI hero-image generation in image-worker (see
   * IMPLEMENTATION_PLAN.md's hero-image-quality addendum). Off falls back
   * to the pre-existing procedural SVG generator. Default on: at a Daily
   * Blog Goal of 3, the worst case (every image collides on the uniqueness
   * check and retries 3x) is ~9 image-generation calls/day against
   * VERTEX_IMAGE_MODEL (gemini-2.5-flash-image), billed per generated image.
   */
  IMAGE_AI_GENERATION_ENABLED: optional("IMAGE_AI_GENERATION_ENABLED", "true") !== "false",

  /** Daily Target Controller safety-net tick - see workers/shared/daily-target.ts. */
  RECONCILE_CRON: optional("RECONCILE_CRON", "*/30 * * * *"),
  /** Only the process with this set registers job schedulers. */
  SCHEDULER_ENABLED: optional("SCHEDULER_ENABLED", "true") !== "false",
  TIMEZONE: optional("TIMEZONE", "Asia/Kolkata"),

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

  // Writing worker
  BLOG_MIN_WORDS: Number(optional("BLOG_MIN_WORDS", "1200")),
  BLOG_MAX_WORDS: Number(optional("BLOG_MAX_WORDS", "2000")),
  /**
   * generateVertexText's call in writing-worker was stuck on
   * withVertexTimeout's generic 30s default - fine for planning/outline's
   * short JSON responses, not for an up-to-8192-token full article draft.
   * Own timeout rather than the shared Vertex default.
   */
  WRITING_TIMEOUT_MS: Number(optional("WRITING_TIMEOUT_MS", "120000")),

  /**
   * Evidence-grounded writing (ENHANCEMENT_IMPLEMENTATION_PLAN.md Task 2).
   * On = the writing prompt receives full-text evidence sources keyed by
   * [S1]-style markers and citations are materialized deterministically in
   * code (workers/writing-worker/citations.ts). Off = legacy
   * titles-only evidenceSummary prompt + verbatim-URL citation check.
   * Requires the submission to actually carry reference sources - unsourced
   * briefs always use the legacy path regardless of this flag.
   */
  GROUNDED_WRITING_ENABLED: optional("GROUNDED_WRITING_ENABLED", "true") !== "false",
  /** Hard evidence/source validation gate. Off = sources are context only and never block the pipeline. */
  EVIDENCE_VALIDATION_ENABLED: optional("EVIDENCE_VALIDATION_ENABLED", "false") !== "false",

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
   *   claim against the submission's reference articles (falls back to the
   *   legacy sampled check when the submission carries no sources).
   * JUDGE_ENABLED: holistic LLM editorial judge as a weighted 12th check.
   * JUDGE_SHADOW_MODE: compute + persist the judge result but DON'T let it
   *   affect pass/fail - mandatory calibration mode before going live.
   * JUDGE_WEIGHT: weight of the judge score in overallScore (rest is the
   *   existing heuristic checks' average).
   * DIMENSION_FLOOR: minimum per-check score (of 10) - one collapsed
   *   dimension can no longer be averaged into a pass.
   */
  /**
   * Global editorial rules (workers/shared/editorial-rules.ts).
   * EDITORIAL_RULES_ENABLED: run the checks at all. Warnings are always
   *   advisory - they are logged and fed into the rewrite/repair prompt.
   * EDITORIAL_RULES_SHADOW_MODE: demote blockers to warnings too, so a noisy
   *   check can be observed on real articles without stalling the pipeline.
   */
  EDITORIAL_RULES_ENABLED: optional("EDITORIAL_RULES_ENABLED", "true") !== "false",
  EDITORIAL_RULES_SHADOW_MODE: optional("EDITORIAL_RULES_SHADOW_MODE", "false") !== "false",

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
