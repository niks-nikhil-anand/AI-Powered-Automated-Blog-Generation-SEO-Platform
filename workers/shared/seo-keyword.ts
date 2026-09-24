/**
 * Focus-keyword matching and placement, shared by the validator that
 * ENFORCES the rules (workers/shared/article-contract.ts) and the code that
 * SATISFIES them (outline/writing workers). Both sides must use the same
 * comparison, otherwise a title the fixer considers keyworded can still be
 * rejected by the contract.
 *
 * The match stays deliberately literal - a focus keyword is a phrase the
 * article is supposed to rank for, so "Next JS SEO" is NOT "Next.js SEO".
 * Normalization only removes differences no reader or crawler cares about:
 * case, curly quotes, unicode dashes, and collapsed/non-breaking whitespace
 * (the kinds of characters an editor pastes in from a doc without meaning to).
 */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;?/gi, "&")
    .replace(/&quot;?/gi, '"')
    .replace(/&apos;?/gi, "'")
    .replace(/&lt;?/gi, "<")
    .replace(/&gt;?/gi, ">");
}

export function cleanBriefText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeForKeywordMatch(value: string): string {
  return cleanBriefText(value)
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `keyword` appears verbatim (modulo normalization) inside `text`. */
export function containsKeyword(text: string | null | undefined, keyword: string | null | undefined): boolean {
  if (!text || !keyword) return false;
  const needle = normalizeForKeywordMatch(keyword);
  if (!needle) return false;
  return normalizeForKeywordMatch(text).includes(needle);
}

/**
 * Truncate at a word boundary instead of mid-word. Returns `value` untouched
 * when it already fits.
 */
export function truncateAtWordBoundary(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const clipped = trimmed.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > Math.floor(maxLength * 0.5) ? clipped.slice(0, lastSpace) : clipped).replace(/[\s:,\-|]+$/, "");
}

/**
 * Guarantee the focus keyword is present in a title-like string (H1, outline
 * title, meta title), prefixing it only when the model didn't place it
 * itself. Idempotent: a title that already contains the phrase comes back
 * byte-identical, so re-running it over a stored title is a no-op.
 *
 * `maxLength` truncates the ORIGINAL title, never the keyword - a meta title
 * that loses its keyword to a length cap would defeat the point (a focus
 * keyword longer than the cap is pathological and is kept whole).
 */
export function ensureKeywordInTitle(
  title: string,
  keyword: string | null | undefined,
  options: { maxLength?: number } = {}
): string {
  const { maxLength } = options;
  const base = cleanBriefText(title);
  const phrase = keyword ? cleanBriefText(keyword) : "";

  if (!phrase) return maxLength ? truncateAtWordBoundary(base, maxLength) : base;
  if (containsKeyword(base, phrase)) return maxLength ? truncateAtWordBoundary(base, maxLength) : base;
  if (!base) return phrase;

  if (!maxLength) return `${phrase}: ${base}`;

  // Keyword + separator is a fixed cost; whatever room is left goes to the
  // original title. No room at all (very long keyword) => keyword alone.
  const room = maxLength - phrase.length - 2;
  if (room <= 0) return phrase;
  return `${phrase}: ${truncateAtWordBoundary(base, room)}`;
}

/** The article's H1 text, or null when the markdown has no H1 line. */
export function extractH1(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Put the focus keyword into the article's H1 when the draft left it out.
 * Returns the repaired title so callers can log that the fallback fired -
 * a silent repair on every article would hide a prompt that stopped working.
 * A no-op when there is no keyword, no H1, or the H1 already carries it.
 */
export function ensureKeywordInH1(
  markdown: string,
  focusKeyword?: string | null
): { markdown: string; repairedH1: string | null; previousH1: string | null } {
  const keyword = focusKeyword ? cleanBriefText(focusKeyword) : "";
  const h1 = extractH1(markdown);
  if (!keyword || !h1 || containsKeyword(h1, keyword)) {
    return { markdown, repairedH1: null, previousH1: h1 };
  }
  const repairedH1 = ensureKeywordInTitle(h1, keyword);
  // Function replacer: a title containing "$&" or "$1" must not be treated
  // as a replacement pattern.
  return { markdown: markdown.replace(/^#\s+.+$/m, () => `# ${repairedH1}`), repairedH1, previousH1: h1 };
}
