import { env } from "../shared/env";
import { generateVertexImage } from "../shared/vertex";
import { hashString } from "./generator";
import { ImageJobPayload } from "../shared/queues";

/**
 * ~6-8 art-direction descriptors to rotate across (issue 54: composition
 * diversity). Selection is hashed off the blog/trend id rather than random
 * so a retry on the same job is reproducible, and rather than sequential so
 * two same-day, same-category blogs don't land on the same direction.
 */
export const STYLE_DIRECTIONS = [
  "isometric illustration",
  "abstract geometric composition",
  "flat vector scene",
  "editorial line art",
  "glassmorphism panel",
  "duotone photographic",
  "low-poly 3D render",
  "papercraft diorama",
] as const;

export type StyleDirection = (typeof STYLE_DIRECTIONS)[number];

export function selectStyleDirection(seed: string, excluded: readonly string[] = []): StyleDirection {
  const available = STYLE_DIRECTIONS.filter((direction) => !excluded.includes(direction));
  const pool = available.length > 0 ? available : STYLE_DIRECTIONS;
  const index = hashString(seed) % pool.length;
  return pool[index];
}

export function buildHeroPrompt(payload: ImageJobPayload, subject: string, style: StyleDirection): string {
  return [
    `A ${style} depicting: ${subject}.`,
    `Editorial technology-blog hero image for a "${payload.category}" article.`,
    "Wide 16:9 composition, clear focal subject, professional and polished, high production value.",
    "No readable text, letters, numbers, or words rendered anywhere in the image.",
    "No real company logos, trademarks, or brand marks - depict generic or abstract equivalents instead.",
  ].join(" ");
}

export async function generateAIHeroImage(
  payload: ImageJobPayload,
  subject: string,
  style: StyleDirection
): Promise<{ buffer: Buffer; mimeType: string }> {
  const prompt = buildHeroPrompt(payload, subject, style);
  return generateVertexImage(env.VERTEX_IMAGE_MODEL, prompt, {
    aspectRatio: "16:9",
    negativePrompt: "text, watermark, logo, signature, blurry, low quality",
  });
}
