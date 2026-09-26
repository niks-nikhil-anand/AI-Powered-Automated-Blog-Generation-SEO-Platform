import { prisma } from "./prisma";
import { STAGE_MODEL_KEYS, type ModelStage } from "./model-registry";

/**
 * Key/value settings backed by the AppSetting table. Shared by both the
 * worker processes and the Next.js app's API routes (same cross-import
 * pattern already used for workers/shared/queues) so a key typo can't make
 * the two sides silently disagree.
 *
 * Three pipeline stages call an LLM through a dashboard-editable setting:
 * planning-worker and outline-worker both call env.VERTEX_FLASH, and
 * writing-worker calls env.VERTEX_MODEL (plus the per-section and
 * self-check keys below). image-worker also calls Vertex (Imagen, via
 * env.VERTEX_IMAGE_MODEL) and quality-worker calls Vertex (Gemini vision,
 * via env.VERTEX_FLASH) for a featured-image relevance/appeal check, but
 * neither is exposed as a MODEL_SETTING_KEYS entry - swapping the image
 * model or the vision model isn't a like-for-like choice the way swapping a
 * text model is, so it stays an env var rather than a dashboard dropdown.
 * scheduler-worker and publish-worker call no AI model at all.
 */
export const MODEL_SETTING_KEYS = Object.fromEntries(
  Object.entries(STAGE_MODEL_KEYS).map(([stage, config]) => [stage, config.legacy])
) as Record<ModelStage, string>;

export const MODEL_PRIMARY_SETTING_KEYS = Object.fromEntries(
  Object.entries(STAGE_MODEL_KEYS).map(([stage, config]) => [stage, config.primary])
) as Record<ModelStage, string>;

export const MODEL_BACKUP_SETTING_KEYS = Object.fromEntries(
  Object.entries(STAGE_MODEL_KEYS).map(([stage, config]) => [stage, config.backup])
) as Record<ModelStage, string>;

export const DAILY_TARGET_KEY = "dailyBlogTarget";

/** Retries AFTER the initial attempt, per pipeline stage - see workers/shared/retry-config.ts. */
export const RETRY_ATTEMPTS_KEY = "retryAttempts";

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

/**
 * Workers call this per-job (not just once at boot), so a short in-memory
 * cache keeps a busy pipeline from hitting Postgres on every single job for
 * a value that changes maybe a few times a day. Falls back to `fallback`
 * both when the row is missing and when the read itself fails, so a DB
 * hiccup degrades to "use the env default" rather than throwing mid-job.
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const value = row ? (row.value as T) : fallback;
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    return fallback;
  }
}

/**
 * Bypass the small in-process cache for settings that must reflect a just-saved
 * dashboard edit. Scheduled publish slots use this at fire time so a worker
 * process that previously cached an unset slot cannot skip a newly configured
 * run.
 */
export async function getSettingFresh<T>(key: string, fallback: T): Promise<T> {
  cache.delete(key);
  return getSetting(key, fallback);
}

export async function setSetting(key: string, value: unknown) {
  const row = await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
  cache.set(key, { value: row.value, expiresAt: Date.now() + CACHE_TTL_MS });
  return row;
}

export async function getAllSettings(keys: string[]) {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
  return new Map(rows.map((row) => [row.key, row.value] as const));
}

/**
 * Removes an override row so the env fallback applies again ("Reset to
 * default" in the dashboard). deleteMany instead of delete so resetting a
 * key that was never overridden is a no-op rather than a P2025 throw.
 */
export async function deleteSetting(key: string) {
  cache.delete(key);
  await prisma.appSetting.deleteMany({ where: { key } });
}
