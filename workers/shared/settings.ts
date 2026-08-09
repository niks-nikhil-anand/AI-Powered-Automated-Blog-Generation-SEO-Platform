import { prisma } from "./prisma";

/**
 * Key/value settings backed by the AppSetting table. Shared by both the
 * worker processes and the Next.js app's API routes (same cross-import
 * pattern already used for workers/shared/queues) so a key typo can't make
 * the two sides silently disagree.
 *
 * Four pipeline stages call an LLM through a dashboard-editable setting:
 * planning-worker and outline-worker both call env.VERTEX_FLASH,
 * writing-worker calls env.VERTEX_MODEL, and research-worker calls
 * env.VERTEX_FLASH for the semantic relevance/dedup pass (see
 * workers/research-worker/pipeline/semantic.ts - this is on top of, not
 * instead of, its heuristic scraping/scoring). image-worker also calls
 * Vertex (Imagen, via env.VERTEX_IMAGE_MODEL) and quality-worker calls
 * Vertex (Gemini vision, via env.VERTEX_FLASH) for a featured-image
 * relevance/appeal check, but neither is exposed as a MODEL_SETTING_KEYS
 * entry - swapping the image model or the vision model isn't a like-for-like
 * choice the way swapping a text model is, so it stays an env var rather
 * than a dashboard dropdown. publish-worker still calls no AI model at all
 * - it's a DB status flip.
 */
export const MODEL_SETTING_KEYS = {
  planning: "model:planning",
  outline: "model:outline",
  writing: "model:writing",
  semantic: "model:semantic",
  /** Quality-worker's LLM editorial judge (Task 4). */
  judge: "model:judge",
  /** Per-section draft generation when sectioned writing is on (Task 5). */
  writingSections: "model:writingSections",
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
