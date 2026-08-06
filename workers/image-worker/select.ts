import { env, isVertexConfigured } from "../shared/env";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { ImageJobPayload } from "../shared/queues";
import { GeneratedImage } from "./types";
import { generateEditorialHeroImage } from "./generator";
import { generateAIHeroImage, selectStyleDirection } from "./ai-generator";
import { compositeHeroImage } from "./overlay";
import { checkImageDimensions, computeImageHash, hammingDistance } from "./quality";

const log = logger.child({ worker: "image-worker" });

const MAX_REGENERATE_ATTEMPTS = 3;
const UNIQUENESS_LOOKBACK = 50;
/** Out of 72 dHash bits (9x8 grid) - below this, treat two images as duplicates (issue 56). */
const UNIQUENESS_MIN_DISTANCE = 10;
const MAX_FALLBACK_SEED_ATTEMPTS = 5;

export type SelectedHeroImage = {
  image: GeneratedImage;
  styleDirection: string | null;
  imageHash: string;
};

export async function recentImageHashes(): Promise<string[]> {
  const rows = await prisma.asset.findMany({
    where: { imageHash: { not: null } },
    orderBy: { createdAt: "desc" },
    take: UNIQUENESS_LOOKBACK,
    select: { imageHash: true },
  });
  return rows.map((row) => row.imageHash as string);
}

function isTooSimilar(hash: string, recent: string[]): boolean {
  return recent.some((existing) => hammingDistance(hash, existing) < UNIQUENESS_MIN_DISTANCE);
}

/**
 * Tries real Imagen generation first (subject + composition vary per
 * topic), regenerating with a fresh style direction when the result fails
 * the dimension gate or is too similar to a recent asset. Falls back to the
 * procedural SVG generator - with a seed salted until it clears the same
 * uniqueness check - when Imagen is disabled, unconfigured, or every
 * attempt is exhausted. See IMPLEMENTATION_PLAN.md's hero-image-quality
 * addendum, Phase C.3.
 */
export async function selectHeroImage(
  payload: ImageJobPayload,
  subject: string,
  recentHashes: string[]
): Promise<SelectedHeroImage> {
  const seed = payload.trendId ?? payload.blogId;

  if (env.IMAGE_AI_GENERATION_ENABLED && isVertexConfigured) {
    const usedStyles: string[] = [];
    for (let attempt = 0; attempt < MAX_REGENERATE_ATTEMPTS; attempt += 1) {
      const style = selectStyleDirection(`${seed}:${attempt}`, usedStyles);
      usedStyles.push(style);
      try {
        const aiImage = await generateAIHeroImage(payload, subject, style);
        const composited = await compositeHeroImage(aiImage, payload);

        const dims = await checkImageDimensions(composited.buffer);
        if (!dims.ok) {
          log.warn("AI hero image failed dimension check, retrying", { attempt, style, reasons: dims.reasons });
          continue;
        }

        const imageHash = await computeImageHash(composited.buffer);
        if (isTooSimilar(imageHash, recentHashes)) {
          log.info("AI hero image too similar to a recent asset, regenerating with a new style", { attempt, style });
          continue;
        }

        return { image: composited, styleDirection: style, imageHash };
      } catch (error) {
        log.warn("AI hero image generation attempt failed, retrying", {
          attempt,
          style,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
    log.warn("Exhausted AI hero image attempts, falling back to procedural SVG", { blogId: payload.blogId });
  }

  let fallbackImage: GeneratedImage = generateEditorialHeroImage(payload);
  let fallbackHash = await computeImageHash(fallbackImage.buffer);
  for (let attempt = 1; attempt < MAX_FALLBACK_SEED_ATTEMPTS && isTooSimilar(fallbackHash, recentHashes); attempt += 1) {
    fallbackImage = generateEditorialHeroImage(payload, `${payload.category}:${payload.title}:${attempt}`);
    fallbackHash = await computeImageHash(fallbackImage.buffer);
  }

  return {
    image: fallbackImage,
    styleDirection: fallbackImage.layout ? `layout:${fallbackImage.layout}` : null,
    imageHash: fallbackHash,
  };
}
