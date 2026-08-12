/**
 * Shared deterministic claim extraction (WRITING_FACT_SAFETY_PLAN.md Task
 * 6.2). Moved here from workers/quality-worker/claims.ts so the writing
 * worker's self-check (writing-worker/selfcheck.ts) extracts claims with
 * the EXACT same code the quality-worker's fact-check verifies - if the
 * two sides tokenized/classified differently, the writer would optimize
 * for a different claim set than the gate checks.
 *
 * Everything in this file is pure (no I/O, no env, no logging) so it is
 * safe to import from both workers and the Next.js app.
 */
export type ExtractedClaim = {
  text: string;
  kind: "numeric" | "temporal" | "version" | "capability" | "other";
};

/** Hard bound on verification cost per article. */
export const MAX_CLAIMS = 25;

const VERSION_RE = /\bv?\d+\.\d+(\.\d+)?(-[\w.]+)?\b/;
const TEMPORAL_RE = /\b(19|20)\d{2}\b|\bQ[1-4]\s?\d{0,4}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/;
const NUMERIC_RE = /\d/;
const CAPABILITY_RE = /\b(supports?|enables?|allows?|offers?|provides?|integrates?|compatible with|ships? with|built[- ]in|outperforms?|faster than|replaces?)\b/i;

/** Structural lines that look like claims but aren't checkable facts. */
const NOISE_LINE_RE = /^(#{1,6}\s|[-*]?\s*\[|\||```|>|\s*\d+\.\s*$)/;

function splitSentences(content: string): string[] {
  return content
    .split(/\n{2,}/) // paragraphs first - keeps table rows/code out via NOISE_LINE_RE below
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 400);
}

function classify(sentence: string): ExtractedClaim["kind"] | null {
  if (VERSION_RE.test(sentence)) return "version";
  if (TEMPORAL_RE.test(sentence)) return "temporal";
  if (NUMERIC_RE.test(sentence)) return "numeric";
  if (CAPABILITY_RE.test(sentence)) return "capability";
  return null;
}

/**
 * Every sentence carrying a digit, date, version, or capability verb is a
 * claim candidate. Deterministic = no sampling = a buried fabricated
 * statistic can't dodge extraction the way it can dodge "pick 5-8".
 */
export function extractClaimsDeterministic(content: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  for (const sentence of splitSentences(content)) {
    if (NOISE_LINE_RE.test(sentence)) continue;
    const kind = classify(sentence);
    if (kind) claims.push({ text: sentence, kind });
  }
  return claims;
}

export function normalizeClaim(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}
