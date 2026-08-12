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

/**
 * Sentences that contain digits/versions/dates but are NOT checkable
 * factual claims - hypothetical framings, questions, code instructions,
 * self-referential article structure, and quoted speech.
 */
const HYPOTHETICAL_RE = /\b(imagine|for example|for instance|let's say|suppose|consider a|what if|think of|picture this)\b/i;
const QUESTION_RE = /\?\s*$/;
const CODE_INSTRUCTION_RE = /\b(run|install|execute|type|enter|press|click|navigate to|open)\s+(the\s+)?(following|this|these)\s+(command|code|command|snippet)/i;
const SELF_REFERENCE_RE = /\b(this article|this guide|this post|we'll cover|we will cover|as we (saw|discussed)|in this section|as shown (above|below)|see (above|below|the))\b/i;
const TOC_LINE_RE = /^\[.+\]\(#.+\)$/;

function splitSentences(content: string): string[] {
  // Strip fenced code blocks before splitting - code content is never a
  // checkable factual claim about the article's subject.
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, "");
  return withoutCodeBlocks
    .split(/\n{2,}/) // paragraphs first - keeps table rows/code out via NOISE_LINE_RE below
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 400);
}

/**
 * Beyond the structural NOISE_LINE_RE check, filter out sentences that
 * match a claim regex but are not actually verifiable factual assertions
 * about the article's subject. Each filter targets a specific false-
 * positive class observed in blocked-at-QA drafts.
 */
function isCheckableClaim(sentence: string): boolean {
  if (HYPOTHETICAL_RE.test(sentence)) return false;
  if (QUESTION_RE.test(sentence)) return false;
  if (CODE_INSTRUCTION_RE.test(sentence)) return false;
  if (SELF_REFERENCE_RE.test(sentence)) return false;
  if (TOC_LINE_RE.test(sentence.trim())) return false;
  return true;
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
    if (!isCheckableClaim(sentence)) continue;
    const kind = classify(sentence);
    if (kind) claims.push({ text: sentence, kind });
  }
  return claims;
}

export function normalizeClaim(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}
