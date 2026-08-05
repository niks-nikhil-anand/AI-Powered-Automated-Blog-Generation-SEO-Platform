import sharp from "sharp";

/**
 * OG-image-friendly minimums (issue 51 in the hero-image-quality addendum).
 * Enforced against the real generated image via sharp, not assumed from the
 * aspect ratio requested from Imagen - a resize/crop step happens in
 * between (see overlay.ts) so the numbers have to be checked post-composite.
 */
export const MIN_WIDTH = 1200;
export const MIN_HEIGHT = 630;
export const MIN_ASPECT_RATIO = 1.7;
export const MAX_ASPECT_RATIO = 2.0;

export type DimensionCheck = {
  ok: boolean;
  width: number;
  height: number;
  reasons: string[];
};

export async function checkImageDimensions(buffer: Buffer): Promise<DimensionCheck> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const aspect = height > 0 ? width / height : 0;

  const reasons: string[] = [];
  if (width < MIN_WIDTH) reasons.push(`width ${width} below minimum ${MIN_WIDTH}`);
  if (height < MIN_HEIGHT) reasons.push(`height ${height} below minimum ${MIN_HEIGHT}`);
  if (aspect < MIN_ASPECT_RATIO || aspect > MAX_ASPECT_RATIO) {
    reasons.push(`aspect ratio ${aspect.toFixed(2)}:1 outside ${MIN_ASPECT_RATIO}-${MAX_ASPECT_RATIO}:1`);
  }

  return { ok: reasons.length === 0, width, height, reasons };
}

const DHASH_WIDTH = 9;
const DHASH_HEIGHT = 8;

/**
 * Difference-hash (dHash): resize to a tiny grayscale grid and record
 * whether each pixel is brighter than its right-hand neighbor. Cheap,
 * deterministic, and comparable across images by Hamming distance - see
 * issue 56 (visual uniqueness) in the hero-image-quality addendum.
 */
export async function computeImageHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let row = 0; row < DHASH_HEIGHT; row += 1) {
    for (let col = 0; col < DHASH_WIDTH - 1; col += 1) {
      const left = data[row * DHASH_WIDTH + col];
      const right = data[row * DHASH_WIDTH + col + 1];
      bits += left > right ? "1" : "0";
    }
  }

  return BigInt(`0b${bits}`).toString(16);
}

export function hammingDistance(hashA: string, hashB: string): number {
  const zero = BigInt(0);
  const one = BigInt(1);
  let diff = BigInt(`0x${hashA}`) ^ BigInt(`0x${hashB}`);
  let distance = 0;
  while (diff > zero) {
    distance += Number(diff & one);
    diff >>= one;
  }
  return distance;
}
