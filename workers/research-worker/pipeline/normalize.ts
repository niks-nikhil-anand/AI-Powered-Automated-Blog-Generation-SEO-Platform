import { fingerprint } from "../utils/fingerprint";
import { extractKeywords, inferCategory, normalizeText, slugify } from "../utils/text";
import { NormalizedSignal, RawSignal } from "../types";

export function normalizeSignals(signals: RawSignal[]): NormalizedSignal[] {
  return signals
    .map((signal) => {
      const normalizedTitle = normalizeText(signal.title);
      const keywords = extractKeywords(signal.title, signal.description);
      return {
        ...signal,
        normalizedTitle,
        slug: slugify(signal.title),
        keywords,
        category: inferCategory(signal.title, signal.tags),
        fingerprint: fingerprint([
          normalizedTitle,
          keywords.slice(0, 5).sort().join(":"),
          signal.url ?? "",
        ]),
      };
    })
    .filter((signal) => signal.normalizedTitle.length > 0 && signal.slug.length > 0);
}
