import sharp from "sharp";
import { ImageJobPayload } from "../shared/queues";
import { GeneratedImage } from "./types";
import { escapeXml, wrapText } from "./generator";

/**
 * Canonical hero canvas. 16:9 sits inside the 1.7-2.0:1 band enforced by
 * quality.ts, and 1600x900 clears the 1200x630 OG-image minimum.
 */
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 900;

/**
 * The fixed brand layer: badge/wordmark, title, and border treatment. Same
 * for every image regardless of topic - this is what resolves the
 * "unique art vs. consistent brand" tension (issue 57 vs. 49-54): variation
 * lives in the AI art underneath, not here.
 */
function brandOverlaySvg(payload: ImageJobPayload): string {
  const titleLines = wrapText(payload.title, 34, 3);
  const titleTspans = titleLines
    .map((line, index) => `<tspan x="118" dy="${index === 0 ? 0 : 60}">${escapeXml(line)}</tspan>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="rgba(2,6,23,0.88)"/>
      <stop offset="55%" stop-color="rgba(2,6,23,0.32)"/>
      <stop offset="100%" stop-color="rgba(2,6,23,0)"/>
    </linearGradient>
  </defs>
  <rect x="3" y="3" width="${CANVAS_WIDTH - 6}" height="${CANVAS_HEIGHT - 6}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="6"/>
  <rect x="0" y="${CANVAS_HEIGHT - 360}" width="${CANVAS_WIDTH}" height="360" fill="url(#scrim)"/>
  <text x="120" y="${CANVAS_HEIGHT - 250}" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="800" letter-spacing="3" fill="rgba(255,255,255,0.78)">${escapeXml(payload.category.toUpperCase())}</text>
  <text x="118" y="${CANVAS_HEIGHT - 195}" font-family="Inter, Arial, sans-serif" font-size="52" font-weight="900" fill="white">${titleTspans}</text>
  <g transform="translate(120 ${CANVAS_HEIGHT - 70})">
    <rect width="258" height="46" rx="14" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.28)"/>
    <text x="24" y="30" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="800" fill="white">DevKit Market Analysis</text>
  </g>
</svg>`;
}

/**
 * Composites AI-generated art (varies per topic) under the fixed brand
 * overlay (constant), and clamps the art's color grade to a bounded range
 * instead of leaving hue fully unconstrained - see overlay.ts's module
 * comment on issue 57 vs. 49-54.
 */
export async function compositeHeroImage(
  aiImage: { buffer: Buffer; mimeType: string },
  payload: ImageJobPayload
): Promise<GeneratedImage> {
  const overlay = Buffer.from(brandOverlaySvg(payload));

  const buffer = await sharp(aiImage.buffer)
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: "cover", position: "attention" })
    .modulate({ brightness: 0.97, saturation: 0.92 })
    .gamma(1.02)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();

  return {
    buffer,
    fileName: "hero.jpg",
    mimeType: "image/jpeg",
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  };
}
