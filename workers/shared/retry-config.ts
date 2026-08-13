import { env } from "./env";
import { RETRY_ATTEMPTS_KEY, getSetting } from "./settings";

/**
 * Dynamic retry configuration. The AppSetting "retryAttempts" (edited on the
 * Settings page) is the single source of truth for how many times a failed
 * pipeline stage is retried AFTER the initial attempt - no hard-coded count
 * anywhere in the pipeline:
 *
 *   Settings (retryAttempts = N)
 *     -> queues.ts defaultJobOptions.attempts getter  = N + 1 (BullMQ total)
 *     -> quality-worker's QA-fail regeneration budget = N + 1 writing tries
 *     -> /api/dashboard retryLimit (quality page UI)  = N + 1
 *
 * BullMQ merges defaultJobOptions into each job at ADD time, so a getter on
 * that object is re-evaluated per enqueue and every new job picks up the
 * current setting. The getter must be synchronous, so it reads this module's
 * in-memory cache; refreshRetryAttempts() keeps it hot - called from
 * startWorkerAttempt (every worker job start, behind the 15s settings cache)
 * and from the settings API after a change.
 */

const MIN_RETRIES = 0;
const MAX_RETRIES = 10;

function clampRetries(value: number): number {
  if (!Number.isFinite(value)) return env.PIPELINE_RETRY_ATTEMPTS;
  return Math.min(MAX_RETRIES, Math.max(MIN_RETRIES, Math.round(value)));
}

/** Total BullMQ attempts (initial try + configured retries) currently in effect for this process. */
let cachedJobAttempts = clampRetries(env.PIPELINE_RETRY_ATTEMPTS) + 1;

/** Retries after the initial attempt, as configured in Settings (AppSetting, env fallback). */
export async function getRetryAttempts(): Promise<number> {
  const raw = await getSetting(RETRY_ATTEMPTS_KEY, env.PIPELINE_RETRY_ATTEMPTS);
  return clampRetries(Number(raw));
}

/** Total BullMQ attempts for new jobs right now (initial + retries). Sync - reads the cache. */
export function currentJobAttempts(): number {
  return cachedJobAttempts;
}

/**
 * Re-reads the setting (15s-cached by getSetting, so this is ~free per job)
 * and updates the process-local cache the queue getters read. Fail-soft: a
 * DB hiccup keeps the previous value rather than throwing mid-job.
 */
export async function refreshRetryAttempts(): Promise<number> {
  cachedJobAttempts = (await getRetryAttempts()) + 1;
  return cachedJobAttempts;
}
