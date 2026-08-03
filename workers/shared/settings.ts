import { prisma } from "./prisma";

/**
 * Key/value settings backed by the AppSetting table. Shared by both the
 * worker processes and the Next.js app's API routes (same cross-import
 * pattern already used for workers/shared/queues) so a key typo can't make
 * the two sides silently disagree.
 *
 * Only three pipeline stages actually call an LLM: planning-worker and
 * outline-worker both call env.VERTEX_FLASH, writing-worker calls
 * env.VERTEX_MODEL. research-worker, image-worker, quality-worker, and
 * publish-worker do not call any AI model - research is scraping/scoring,
 * image-worker draws an SVG locally, quality-worker is a deterministic
 * regex/heuristic scorer, and publish is a DB status flip. There is
 * deliberately no MODEL_SETTING_KEYS entry for those four - a dropdown
 * for a stage with nothing to configure would be misleading, not a
 * convenience.
 */
export const MODEL_SETTING_KEYS = {
  planning: "model:planning",
  outline: "model:outline",
  writing: "model:writing",
} as const;

export type ModelStage = keyof typeof MODEL_SETTING_KEYS;

export const DAILY_TARGET_KEY = "dailyBlogTarget";

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
