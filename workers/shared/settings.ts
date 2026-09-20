import { prisma } from "./prisma";

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
export const MODEL_SETTING_KEYS = {
  planning: "model:planning",
  outline: "model:outline",
  writing: "model:writing",
  /** Quality-worker's LLM editorial judge (Task 4). */
  judge: "model:judge",
  /** Per-section draft generation when sectioned writing is on (Task 5). */
  writingSections: "model:writingSections",
  /** Write-time claim self-check verification batches (Task 6). */
  writingSelfcheck: "model:writingSelfcheck",
} as const;

export type ModelStage = keyof typeof MODEL_SETTING_KEYS;

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
