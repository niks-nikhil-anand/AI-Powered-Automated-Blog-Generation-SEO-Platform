import { z } from "zod";
import { env, isVertexConfigured } from "../shared/env";
import { batchStagger, generateVertexJson } from "../shared/vertex";
import { type EvidenceArticle } from "../shared/evidence";
import { extractClaims } from "./claims";

const FactCheckVerdictSchema = z.enum(["supported", "unsupported", "uncertain"]);
export type FactCheckVerdict = z.infer<typeof FactCheckVerdictSchema>;

const FactCheckClaimSchema = z.object({
  claim: z.string(),
  verdict: FactCheckVerdictSchema,
  confidence: z.number(),
  note: z.string().optional(),
});
export type FactCheckClaim = z.infer<typeof FactCheckClaimSchema>;

const FactCheckResponseSchema = z.object({
  claims: z.array(FactCheckClaimSchema),
});

export type FactCheckResult = {
  claims: FactCheckClaim[];
  /** 0-100: confidence-weighted share of claims the evidence actually backs. */
  score: number;
  usage: { promptTokens: number; completionTokens: number };
  model: string;
};

const VERDICT_WEIGHT: Record<FactCheckVerdict, number> = {
  supported: 1,
  uncertain: 0.5,
  unsupported: 0,
};

function buildPrompt(content: string, evidenceSummary: string): string {
  return `You are a fact-checking editor for a technical blog. Compare the ARTICLE below against the EVIDENCE it was supposed to be grounded in, and flag anything the article states as fact that the evidence doesn't actually support.

EVIDENCE (the research source material this article should be grounded in):
${evidenceSummary}

ARTICLE:
${content}

Extract the 5-8 most significant factual claims in the article - specific numbers, named products/companies/versions, dates, capability or performance claims. Skip generic advice or opinion that isn't a checkable factual claim. For each claim, assess it against the evidence:
- "supported": the evidence backs this claim.
- "unsupported": the evidence contradicts it, or doesn't mention it at all.
- "uncertain": the evidence is ambiguous or only partially related.

Return ONLY JSON in this exact shape:
{"claims": [{"claim": "short paraphrase of the claim", "verdict": "supported"|"unsupported"|"uncertain", "confidence": 0-100, "note": "one sentence explaining the verdict"}]}`;
}

/**
 * One Vertex Flash call per blog, comparing the draft against the research
 * evidence persisted on its Trend (Trend.evidenceSummary - see
 * IMPLEMENTATION_PLAN.md Phase 2.1). Returns null - never throws - when
 * there's nothing to check against or the call/parse itself fails, so a
 * Vertex hiccup degrades this one score dimension instead of failing the
 * whole quality pass. Caller (scorer.ts) treats null as "couldn't verify",
 * not as "verified clean".
 */
export async function runFactCheck(content: string, evidenceSummary: string): Promise<FactCheckResult | null> {
  if (!isVertexConfigured || !evidenceSummary.trim()) return null;

  try {
    const model = env.VERTEX_FLASH;
    // Deferrable: a fact-check that can't run degrades one score dimension.
    const result = await generateVertexJson<unknown>(model, buildPrompt(content, evidenceSummary), { priority: "deferrable" });
    const parsed = FactCheckResponseSchema.safeParse(result.data);
    if (!parsed.success || parsed.data.claims.length === 0) return null;

    const claims = parsed.data.claims;
    const weighted = claims.reduce((sum, claim) => {
      const weight = VERDICT_WEIGHT[claim.verdict];
      const confidence = Math.max(0, Math.min(100, claim.confidence));
      return sum + weight * confidence;
    }, 0);
    const score = Math.round(weighted / claims.length);

    return { claims, score, usage: result.usage, model };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Task 3: claim-level fact checking against full-text evidence              */
/* ------------------------------------------------------------------------ */

/**
 * Extended verdict set for the full check. "unverifiable" = no source
 * relates to the claim at all - the hallucination tell that "unsupported"
 * had to absorb in the legacy sampled check.
 */
const FullVerdictSchema = z.enum(["supported", "unsupported", "uncertain", "unverifiable"]);
export type FullFactCheckVerdict = z.infer<typeof FullVerdictSchema>;

const FullClaimSchema = z.object({
  claim: z.string(),
  verdict: FullVerdictSchema,
  confidence: z.number(),
  note: z.string().optional(),
  sourceUrl: z.string().optional(),
});
export type FullFactCheckClaim = z.infer<typeof FullClaimSchema>;

const FullBatchResponseSchema = z.object({ claims: z.array(FullClaimSchema) });

export type FullFactCheckDetail = {
  mode: "full";
  totalClaims: number;
  supported: number;
  uncertain: number;
  unsupported: number;
  unverifiable: number;
  coveragePct: number;
  claims: FullFactCheckClaim[];
};

export type FullFactCheckResult = {
  /** Same shape as FactCheckResult.claims for scorer compatibility, verdict superset. */
  claims: FullFactCheckClaim[];
  score: number;
  usage: { promptTokens: number; completionTokens: number };
  model: string;
  detail: FullFactCheckDetail;
};

const FULL_VERDICT_WEIGHT: Record<FullFactCheckVerdict, number> = {
  supported: 1,
  uncertain: 0.5,
  unverifiable: 0.25,
  unsupported: 0,
};

const VERIFY_BATCH_SIZE = 10;
/** If more than this share of claims binds to no evidence at all, the score is capped below the hard gate. */
const UNVERIFIABLE_CAP_RATIO = 0.3;
const UNVERIFIABLE_SCORE_CAP = 60;

function buildVerifyPrompt(claims: string[], articles: EvidenceArticle[]): string {
  const sourcesBlock = articles
    .map((article, index) => `[S${index + 1}] ${article.title} - ${article.url}\n    "${article.excerpt}"`)
    .join("\n");
  return `You are a fact-checking editor for a technical blog. Verify each CLAIM below against the SOURCES (full-text excerpts of the research evidence the article was grounded in).

SOURCES:
${sourcesBlock}

CLAIMS:
${claims.map((claim, index) => `${index + 1}. "${claim}"`).join("\n")}

For each claim return exactly one verdict:
- "supported": a source explicitly backs the claim.
- "unsupported": a source directly contradicts the claim.
- "uncertain": the sources are related but only partially confirm it.
- "unverifiable": NO source relates to the claim at all (the article asserts it from nowhere).

Return ONLY JSON, one entry per claim, same order:
{"claims": [{"claim": "the claim text", "verdict": "supported"|"unsupported"|"uncertain"|"unverifiable", "confidence": 0-100, "note": "one sentence", "sourceUrl": "source URL if supported, else omit"}]}`;
}

/**
 * Full-coverage fact check (ENHANCEMENT_IMPLEMENTATION_PLAN.md Task 3):
 * every extracted claim (deterministic + model extraction, claims.ts) is
 * verified against the full-text evidence articles in parallel batches of
 * 10. Never throws: a failed batch marks its claims "unverifiable", a total
 * failure returns null - same fail-open contract as runFactCheck.
 */
export async function runFullFactCheck(content: string, articles: EvidenceArticle[]): Promise<FullFactCheckResult | null> {
  if (!isVertexConfigured || articles.length === 0) return null;

  try {
    const extraction = await extractClaims(content);
    if (extraction.claims.length === 0) return null;

    const model = env.VERTEX_FLASH;
    const batches: string[][] = [];
    const claimTexts = extraction.claims.map((claim) => claim.text);
    for (let i = 0; i < claimTexts.length; i += VERIFY_BATCH_SIZE) {
      batches.push(claimTexts.slice(i, i + VERIFY_BATCH_SIZE));
    }

    // Staggered starts - docs/VERTEX_429_RESILIENCE_PLAN.md Task 9.
    const results = await Promise.allSettled(
      batches.map(async (batch, index) => {
        await batchStagger(index);
        return generateVertexJson<unknown>(model, buildVerifyPrompt(batch, articles), { priority: "deferrable" });
      })
    );

    const verified: FullFactCheckClaim[] = [];
    const usage = { promptTokens: 0, completionTokens: 0 };
    if (extraction.extractionUsage) {
      usage.promptTokens += extraction.extractionUsage.promptTokens;
      usage.completionTokens += extraction.extractionUsage.completionTokens;
    }

    results.forEach((result, batchIndex) => {
      const batchClaims = batches[batchIndex];
      if (result.status === "rejected") {
        // Failed batch: its claims are unverifiable this run, never fatal.
        for (const claim of batchClaims) {
          verified.push({ claim, verdict: "unverifiable", confidence: 0, note: "Verification batch failed" });
        }
        return;
      }
      usage.promptTokens += result.value.usage.promptTokens;
      usage.completionTokens += result.value.usage.completionTokens;

      const parsed = FullBatchResponseSchema.safeParse(result.value.data);
      if (!parsed.success) {
        for (const claim of batchClaims) {
          verified.push({ claim, verdict: "unverifiable", confidence: 0, note: "Verification response invalid" });
        }
        return;
      }
      // Align returned verdicts to batch claims by index; missing entries
      // (model dropped one) become unverifiable rather than disappearing.
      batchClaims.forEach((claim, claimIndex) => {
        verified.push(
          parsed.data.claims[claimIndex] ?? { claim, verdict: "unverifiable", confidence: 0, note: "No verdict returned" }
        );
      });
    });

    const counts = { supported: 0, uncertain: 0, unsupported: 0, unverifiable: 0 };
    let weighted = 0;
    for (const claim of verified) {
      counts[claim.verdict] += 1;
      const confidence = Math.max(0, Math.min(100, claim.confidence));
      weighted += FULL_VERDICT_WEIGHT[claim.verdict] * confidence;
    }
    let score = Math.round(weighted / verified.length);
    const unverifiableRatio = counts.unverifiable / verified.length;
    if (unverifiableRatio > UNVERIFIABLE_CAP_RATIO) {
      score = Math.min(score, UNVERIFIABLE_SCORE_CAP);
    }

    const detail: FullFactCheckDetail = {
      mode: "full",
      totalClaims: verified.length,
      ...counts,
      coveragePct: Math.round(((verified.length - counts.unverifiable) / verified.length) * 100),
      claims: verified,
    };

    return { claims: verified, score, usage, model: extraction.extractionModel ?? model, detail };
  } catch {
    return null;
  }
}
