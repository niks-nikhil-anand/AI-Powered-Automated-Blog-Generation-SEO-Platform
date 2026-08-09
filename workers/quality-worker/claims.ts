import { z } from "zod";
import { env, isVertexConfigured } from "../shared/env";
import { generateVertexJson } from "../shared/vertex";
import { logger } from "../shared/logger";

const log = logger.child({ worker: "quality-worker", stage: "claims" });

/**
 * Claim extraction for claim-level fact checking
 * (ENHANCEMENT_IMPLEMENTATION_PLAN.md Task 3). The legacy fact-check asks
 * the model to pick "the 5-8 most significant claims" - meaning the model
 * also decides which claims escape scrutiny. Extraction here is two-tier:
 * deterministic regexes sweep up every numeric/temporal/version claim (the
 * highest-risk hallucination classes) with no sampling, then one cheap
 * model call adds capability/comparison claims regexes can't catch.
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

const ModelClaimsSchema = z.object({ claims: z.array(z.string()) });

/**
 * One Flash call for the claim class regexes can't see: capability and
 * comparison statements phrased without digits or trigger verbs in narrow
 * forms. Best-effort - failure returns [] and deterministic claims still
 * get verified.
 */
export async function extractClaimsWithModel(content: string): Promise<{ claims: string[]; usage: { promptTokens: number; completionTokens: number }; model: string } | null> {
  if (!isVertexConfigured) return null;
  try {
    const model = env.VERTEX_FLASH;
    const result = await generateVertexJson<unknown>(
      model,
      `You are preparing a technical blog article for fact-checking. Extract every sentence from the ARTICLE that asserts a specific capability, compatibility, integration, performance comparison, or feature of a named product/company/technology (e.g. "X supports Y", "A outperforms B", "X integrates with Z"). Skip opinions, generic advice, and anything without a named subject. Return ONLY JSON: {"claims": ["sentence 1", "sentence 2"]}. Return at most 15 claims, verbatim from the article.

ARTICLE:
${content}`
    );
    const parsed = ModelClaimsSchema.safeParse(result.data);
    if (!parsed.success) return null;
    return { claims: parsed.data.claims.slice(0, 15), usage: result.usage, model };
  } catch (error) {
    log.warn("Model claim extraction failed, continuing with deterministic claims only", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function normalizeClaim(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Combined extraction: deterministic sweep + model sweep, deduped by
 * normalized text (model claims that restate a deterministic hit merge into
 * it), capped at MAX_CLAIMS with deterministic claims kept first - they
 * carry the numeric risk.
 */
export async function extractClaims(content: string): Promise<{
  claims: ExtractedClaim[];
  extractionUsage: { promptTokens: number; completionTokens: number } | null;
  extractionModel: string | null;
}> {
  const deterministic = extractClaimsDeterministic(content);
  const seen = new Set(deterministic.map((claim) => normalizeClaim(claim.text)));

  const modelResult = await extractClaimsWithModel(content);
  const modelClaims: ExtractedClaim[] = [];
  if (modelResult) {
    for (const text of modelResult.claims) {
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (cleaned.length < 30 || cleaned.length > 400) continue;
      const key = normalizeClaim(cleaned);
      if (seen.has(key)) continue;
      seen.add(key);
      modelClaims.push({ text: cleaned, kind: "capability" });
    }
  }

  const claims = [...deterministic, ...modelClaims].slice(0, MAX_CLAIMS);
  log.info("Claims extracted", {
    deterministic: deterministic.length,
    model: modelClaims.length,
    total: claims.length,
  });

  return {
    claims,
    extractionUsage: modelResult?.usage ?? null,
    extractionModel: modelResult?.model ?? null,
  };
}
