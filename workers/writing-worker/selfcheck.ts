import { z } from "zod";
import { env, isVertexConfigured } from "../shared/env";
import { batchStagger, generateVertexJson } from "../shared/vertex";
import { logger } from "../shared/logger";
import { recordAIUsage } from "../shared/pricing";
import { getSetting, MODEL_SETTING_KEYS } from "../shared/settings";
import { extractClaimsDeterministic, MAX_CLAIMS } from "../shared/claims";
import { splitIntoSections } from "./sections";
import type { GroundedSource } from "./citations";

const log = logger.child({ worker: "writing-worker", stage: "selfcheck" });

/**
 * Write-time claim self-check (WRITING_FACT_SAFETY_PLAN.md Task 6.3/6.5).
 *
 * The quality worker's fact check is the first place today that a draft's
 * claims meet the evidence - and by then a failure costs a full pipeline
 * loop (requeue, blind rewrite, re-image, re-QA). This module runs the
 * SAME verification at write time, while the draft can still be repaired
 * cheaply: deterministic claim extraction (shared with QA so both sides
 * agree on what a claim is), batched Flash verification against the same
 * evidence input QA will see, and the same scoring rule (verdict weights,
 * unverifiable cap, pass threshold) the scorer applies.
 *
 * Fail-soft contract identical to quality-worker's factcheck.ts: any
 * misconfiguration, call failure, or invalid response returns null and
 * the caller proceeds exactly as if the feature were off.
 */

/** Mirrors scorer.ts's CRITICAL_FACT_CHECK_THRESHOLD - the writer optimizes for the exact gate QA applies. */
export const SELFCHECK_PASS_SCORE = 70;

const VERDICTS = ["supported", "unsupported", "uncertain", "unverifiable"] as const;
export type SelfCheckVerdict = (typeof VERDICTS)[number];

export type SelfCheckIssue = {
  claim: string;
  verdict: Exclude<SelfCheckVerdict, "supported">;
  note?: string;
  /** H2 heading the claim lives in; null = preamble/intro. */
  section: string | null;
};

export type SelfCheckResult = {
  /** Same confidence-weighted formula (and unverifiable cap) as factcheck.ts's full check. */
  score: number;
  /** Every non-supported claim, mapped to its section. */
  issues: SelfCheckIssue[];
  totalClaims: number;
  model: string;
};

const SelfCheckClaimSchema = z.object({
  claim: z.string(),
  verdict: z.enum(VERDICTS),
  confidence: z.number(),
  note: z.string().optional(),
});

const SelfCheckBatchSchema = z.object({ claims: z.array(SelfCheckClaimSchema) });

type VerifiedClaim = z.infer<typeof SelfCheckClaimSchema>;

/** Same weights as factcheck.ts's FULL_VERDICT_WEIGHT - keep in sync. */
const VERDICT_WEIGHT: Record<SelfCheckVerdict, number> = {
  supported: 1,
  uncertain: 0.5,
  unverifiable: 0.4,
  unsupported: 0,
};

/** Same cap rule as factcheck.ts: mostly-ungrounded articles cannot pass. */
const UNVERIFIABLE_CAP_RATIO = 0.4;
const UNVERIFIABLE_SCORE_CAP = 60;

const VERIFY_BATCH_SIZE = 10;

function buildVerifyPrompt(claims: string[], sources: GroundedSource[], evidenceSummary: string | null): string {
  const evidenceBlock =
    sources.length > 0
      ? `SOURCES (full-text excerpts of the research evidence - the ONLY ground truth):
${sources.map((source) => `${source.marker} ${source.title} - ${source.url}\n    "${source.excerpt}"`).join("\n")}`
      : `EVIDENCE (the research source material - the ONLY ground truth):
${evidenceSummary}`;

  return `You are a fact-checking editor reviewing a draft BEFORE publication. Verify each CLAIM below against the evidence.

${evidenceBlock}

CLAIMS:
${claims.map((claim, index) => `${index + 1}. "${claim}"`).join("\n")}

For each claim return exactly one verdict:
- "supported": the evidence explicitly backs the claim.
- "unsupported": the evidence directly contradicts the claim.
- "uncertain": the evidence is related but only partially confirms it.
- "unverifiable": NO evidence relates to the claim at all (the draft asserts it from nowhere).

Return ONLY JSON, one entry per claim, same order:
{"claims": [{"claim": "the claim text", "verdict": "supported"|"unsupported"|"uncertain"|"unverifiable", "confidence": 0-100, "note": "one sentence"}]}`;
}

function scoreVerifiedClaims(verified: VerifiedClaim[]): number {
  const counts = { unverifiable: 0 };
  let weighted = 0;
  for (const claim of verified) {
    if (claim.verdict === "unverifiable") counts.unverifiable += 1;
    const confidence = Math.max(0, Math.min(100, claim.confidence));
    weighted += VERDICT_WEIGHT[claim.verdict] * confidence;
  }
  let score = Math.round(weighted / verified.length);
  if (counts.unverifiable / verified.length > UNVERIFIABLE_CAP_RATIO) {
    score = Math.min(score, UNVERIFIABLE_SCORE_CAP);
  }
  return score;
}

/**
 * Map a claim back to the H2 section that contains it. Claim text comes
 * from extractClaimsDeterministic (whitespace-collapsed), so both sides
 * are whitespace-normalized before the substring test. Returns null for
 * the preamble (title + intro) or when the claim can't be located (e.g.
 * the draft was edited between extraction and mapping) - callers that
 * splice sections must treat an unmatched section as "whole-article
 * problem" and fall back to a full redraft.
 */
export function locateClaimSection(markdown: string, claim: string): string | null {
  const needle = claim.replace(/\s+/g, " ").trim();
  for (const section of splitIntoSections(markdown)) {
    if (section.body.replace(/\s+/g, " ").includes(needle)) return section.heading;
  }
  return null;
}

/**
 * Verify every deterministic claim in the draft against the evidence the
 * quality worker will use (grounded [S]-sources when available, else the
 * legacy evidenceSummary). Records one AIUsage row per batch call. Never
 * throws - null means "couldn't verify", and the caller fails open.
 */
export async function selfCheckClaims(
  markdown: string,
  sources: GroundedSource[],
  evidenceSummary: string | null,
  trendId?: string
): Promise<SelfCheckResult | null> {
  if (!isVertexConfigured) return null;
  if (sources.length === 0 && !evidenceSummary?.trim()) return null;

  try {
    const claims = extractClaimsDeterministic(markdown).slice(0, MAX_CLAIMS);
    if (claims.length === 0) return null;

    const model = await getSetting(MODEL_SETTING_KEYS.writingSelfcheck, env.VERTEX_FLASH);
    const claimTexts = claims.map((claim) => claim.text);
    const batches: string[][] = [];
    for (let i = 0; i < claimTexts.length; i += VERIFY_BATCH_SIZE) {
      batches.push(claimTexts.slice(i, i + VERIFY_BATCH_SIZE));
    }

    const startedAt = Date.now();
    // Staggered starts - docs/VERTEX_429_RESILIENCE_PLAN.md Task 9.
    const results = await Promise.allSettled(
      batches.map(async (batch, index) => {
        await batchStagger(index);
        // Deferrable: self-check is pre-publication enrichment - a quota
        // breaker skips it and the writing gate fails open.
        return generateVertexJson<unknown>(model, buildVerifyPrompt(batch, sources, evidenceSummary ?? null), { priority: "deferrable" });
      })
    );

    const verified: VerifiedClaim[] = [];
    results.forEach((result, batchIndex) => {
      const batchClaims = batches[batchIndex];
      if (result.status === "rejected") {
        // Failed batch: its claims are unverifiable this run, never fatal.
        for (const claim of batchClaims) {
          verified.push({ claim, verdict: "unverifiable", confidence: 0, note: "Verification batch failed" });
        }
        return;
      }
      // Cost tracking per batch call - same pattern as every other Vertex
      // call site (workers/shared/pricing.ts). Wall-clock latency is split
      // evenly across the parallel batches.
      void recordAIUsage({
        worker: "writing-worker",
        model,
        usage: result.value.usage,
        latencyMs: Math.round((Date.now() - startedAt) / batches.length),
        trendId,
      }).catch((error) => log.warn("Self-check usage recording failed (non-fatal)", { error: String(error) }));

      const parsed = SelfCheckBatchSchema.safeParse(result.value.data);
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

    const issues: SelfCheckIssue[] = verified
      .filter((claim): claim is VerifiedClaim & { verdict: SelfCheckIssue["verdict"] } => claim.verdict !== "supported")
      .map((claim) => ({
        claim: claim.claim,
        verdict: claim.verdict,
        note: claim.note,
        section: locateClaimSection(markdown, claim.claim),
      }));

    const score = scoreVerifiedClaims(verified);
    log.info("Claim self-check complete", {
      trendId,
      totalClaims: verified.length,
      issues: issues.length,
      score,
      passScore: SELFCHECK_PASS_SCORE,
    });

    return { score, issues, totalClaims: verified.length, model };
  } catch (error) {
    log.warn("Claim self-check failed, proceeding without it", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Task 6.5: per-claim marker enforcement (grounded mode)                    */
/* ------------------------------------------------------------------------ */

const MARKER_RE = /\[S\d+\]/;

/**
 * Every sentence the deterministic extractor flags as a specific claim
 * must carry its [S]-marker in grounded mode - an unmarked specific is a
 * near-certain "unverifiable" verdict at QA. Pure string work, zero model
 * cost. MUST run on the pre-materialization draft (markers still present);
 * after materializeCitations the markers are gone by design.
 */
export function findUnmarkedClaims(markdown: string): string[] {
  return extractClaimsDeterministic(markdown)
    .filter((claim) => !MARKER_RE.test(claim.text))
    .map((claim) => claim.text);
}

/* ------------------------------------------------------------------------ */
/* Repair-note builder (Task 6.4)                                            */
/* ------------------------------------------------------------------------ */

const VERDICT_GUIDANCE: Record<SelfCheckIssue["verdict"], string> = {
  unsupported: "the evidence contradicts this - correct it to what the evidence actually says, with the source marker attached",
  uncertain: "the evidence only partially confirms this - soften it to exactly what the evidence states, with the source marker attached",
  unverifiable: "no source covers this - remove it or rewrite it qualitatively (no specific number/date/version/capability)",
};

/**
 * Formats failing claims (and unmarked-claim violations) into the
 * repairNote generateSection already understands - the same "failed
 * editorial review" contract Task 5's targeted repair uses.
 */
export function buildClaimRepairNote(issues: SelfCheckIssue[], unmarkedClaims: string[] = []): string {
  const lines = issues.map(
    (issue) => `- "${issue.claim}" (${issue.verdict}: ${VERDICT_GUIDANCE[issue.verdict]}${issue.note ? `; checker note: ${issue.note}` : ""})`
  );
  const unmarked =
    unmarkedClaims.length > 0
      ? `\nThese specific claims also lack their [S]-source marker - attach the marker of the source that states each fact, or rewrite the claim qualitatively:\n${unmarkedClaims
          .map((claim) => `- "${claim}"`)
          .join("\n")}`
      : "";
  return `The previous version of this section failed evidence verification. Fix each of these claims:
${lines.join("\n")}${unmarked}
Do not introduce any new specific number, date, version, or capability that the SOURCES do not explicitly state. Keep everything that already worked.`;
}
