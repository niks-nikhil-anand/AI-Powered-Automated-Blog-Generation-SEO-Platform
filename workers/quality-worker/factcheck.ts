import { z } from "zod";
import { env, isVertexConfigured } from "../shared/env";
import { generateVertexJson } from "../shared/vertex";

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
    const result = await generateVertexJson<unknown>(model, buildPrompt(content, evidenceSummary));
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
