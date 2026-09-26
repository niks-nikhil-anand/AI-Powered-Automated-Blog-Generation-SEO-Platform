import { generateStageJson } from "../shared/ai-router";
import { logger } from "../shared/logger";
import { PlanningResult, PlanningResultSchema } from "./types";

const log = logger.child({ worker: "planning-worker" });

/**
 * The parts of a BlogInput the planner has to honour rather than invent.
 * Anything the user left blank is what the model is actually for.
 */
export type PlanningSpec = {
  title: string;
  category: string;
  audience?: string | null;
  searchIntent?: string | null;
  tone?: string | null;
  contentLength?: number | null;
  focusKeyword?: string | null;
  keywords: string[];
  secondaryKeywords: string[];
};

function specBlock(spec: PlanningSpec): string {
  const lines = [
    `Title: ${spec.title}`,
    `Category: ${spec.category}`,
    spec.audience ? `Target audience (user-specified, use verbatim): ${spec.audience}` : null,
    spec.searchIntent ? `Search intent (user-specified, use verbatim): ${spec.searchIntent}` : null,
    spec.tone ? `Tone: ${spec.tone}` : null,
    spec.contentLength ? `Target length: ${spec.contentLength} words` : null,
    spec.focusKeyword ? `Focus keyword (must be the primaryKeyword): ${spec.focusKeyword}` : null,
    spec.keywords.length > 0 ? `Primary keywords: ${spec.keywords.join(", ")}` : null,
    spec.secondaryKeywords.length > 0 ? `Secondary keywords: ${spec.secondaryKeywords.join(", ")}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Two prompts in one, chosen by whether the submission carried reference
 * sources:
 *
 *  - SOURCED: identical contract to the old research-driven planner - every
 *    plannedClaim must map to a supplied source's extracted facts, and the
 *    evidence validator rejects the plan otherwise.
 *  - UNSOURCED: the user's specification IS the brief. No plannedClaims are
 *    requested (an empty array is correct), because there is nothing to
 *    ground them in and inventing them would be worse than omitting them.
 */
function buildPrompt(spec: PlanningSpec, evidenceSummary: string, evidenceSources: unknown[] = []): string {
  const sourced = evidenceSources.length > 0;
  const evidenceBlock = sourced
    ? `Evidence:
${evidenceSummary}

Canonical evidence sources (the only basis for factual claims):
${JSON.stringify(evidenceSources, null, 2)}`
    : `This submission carries no reference sources. Plan the article from the
specification alone: stay conceptual and instructional, and do not assert
statistics, version numbers, dates, benchmarks, or named third-party
capabilities you cannot derive from the specification itself.`;

  const claimsKey = sourced
    ? `  "plannedClaims": [{"claim":"narrow factual claim","evidenceSourceIds":["S1"],"supportLevel":"direct"}]`
    : `  "plannedClaims": []`;

  const claimsRule = sourced
    ? `Every planned claim MUST be directly or explicitly supported by a source's evidence array. If evidence is insufficient, omit the claim. Do not plan unsupported benefits, advice, problems, or implementation details.`
    : `Return plannedClaims as an empty array - there are no sources to ground factual claims in.`;

  return `You are a senior SEO content strategist for a developer-focused technical blog.

Create a content plan for this editor-submitted blog specification. Fields the
editor already specified are decisions, not suggestions: reuse them verbatim
and fill in only what is missing.

${specBlock(spec)}

${evidenceBlock}

Return ONLY a JSON object with these keys:
{
  "searchIntent": "reader intent in one sentence",
  "audience": "specific target reader",
  "angle": "clear original article angle",
  "primaryKeyword": "one primary keyword",
  "secondaryKeywords": ["4-8 keyword strings"],
  "competitorNotes": ["3-5 notes about how to make this better than generic coverage"],
  "internalNotes": "optional notes; never invent technical details",
${claimsKey}
}

${claimsRule}`;
}

/**
 * Used when Vertex is unconfigured or the response fails schema validation.
 * With a manual specification this is a much better fallback than it used to
 * be: most of the plan is simply the editor's own input echoed back.
 */
function fallbackPlan(spec: PlanningSpec, evidenceSummary: string): PlanningResult {
  const primaryKeyword = spec.focusKeyword || spec.keywords[0] || spec.title.toLowerCase().split(":")[0].slice(0, 80);
  const secondary = spec.secondaryKeywords.length > 0
    ? spec.secondaryKeywords
    : [spec.category.toLowerCase(), "developer guide", "technical analysis", primaryKeyword];
  return {
    searchIntent: spec.searchIntent || `Understand the practical developer impact of ${spec.title}.`,
    audience: spec.audience || `${spec.category} developers and technical decision makers`,
    angle: `Explain ${spec.title} through implementation impact, tradeoffs, and next steps for developers.`,
    primaryKeyword,
    secondaryKeywords: secondary,
    competitorNotes: [
      "Focus on practical implementation details.",
      "Separate confirmed facts from interpretation.",
      "Include actionable takeaways for engineering teams.",
    ],
    internalNotes: evidenceSummary || `Tone: ${spec.tone ?? "professional"}. Target length: ${spec.contentLength ?? 2000} words.`,
    plannedClaims: [],
  };
}

/**
 * The editor's explicit choices always win over the model's, so a
 * hand-written audience/intent/keyword can never be quietly paraphrased away.
 */
function applySpecOverrides(plan: PlanningResult, spec: PlanningSpec): PlanningResult {
  const secondaryKeywords = Array.from(
    new Set([...spec.secondaryKeywords, ...plan.secondaryKeywords].filter(Boolean))
  );
  return {
    ...plan,
    searchIntent: spec.searchIntent || plan.searchIntent,
    audience: spec.audience || plan.audience,
    primaryKeyword: spec.focusKeyword || spec.keywords[0] || plan.primaryKeyword,
    secondaryKeywords: secondaryKeywords.length > 0 ? secondaryKeywords : plan.secondaryKeywords,
  };
}

export async function generateContentPlan(
  spec: PlanningSpec,
  evidenceSummary: string,
  evidenceSources: unknown[] = []
): Promise<{ plan: PlanningResult; usage: { promptTokens: number; completionTokens: number }; model: string }> {
  let result: Awaited<ReturnType<typeof generateStageJson<unknown>>>;
  try {
    result = await generateStageJson<unknown>("planning", buildPrompt(spec, evidenceSummary, evidenceSources));
  } catch (error) {
    log.warn("Planning model unavailable, using fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      plan: applySpecOverrides(fallbackPlan(spec, evidenceSummary), spec),
      usage: { promptTokens: 0, completionTokens: 0 },
      model: "fallback",
    };
  }
  const parsed = PlanningResultSchema.safeParse(result.data);
  if (!parsed.success) {
    log.warn(`Planning response failed schema validation, using fallback: ${parsed.error.message}`);
    return {
      plan: applySpecOverrides(fallbackPlan(spec, evidenceSummary), spec),
      usage: result.usage,
      model: "fallback",
    };
  }
  return { plan: applySpecOverrides(parsed.data, spec), usage: result.usage, model: result.model };
}
