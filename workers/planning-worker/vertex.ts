import { env, isVertexConfigured } from "../shared/env";
import { generateVertexJson } from "../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../shared/settings";
import { logger } from "../shared/logger";
import { PlanningResult, PlanningResultSchema } from "./types";

const log = logger.child({ worker: "planning-worker" });

function buildPrompt(topic: string, category: string, score: number, evidenceSummary: string, evidenceSources: unknown[] = []): string {
  return `You are a senior SEO content strategist for a developer-focused technical blog.

Create a content plan for this research topic.

Topic: ${topic}
Category: ${category}
Research score: ${score}
Evidence:
${evidenceSummary}

Canonical evidence sources (the only basis for factual claims):
${JSON.stringify(evidenceSources, null, 2)}

Return ONLY a JSON object with these keys:
{
  "searchIntent": "reader intent in one sentence",
  "audience": "specific target reader",
  "angle": "clear original article angle",
  "primaryKeyword": "one primary keyword",
  "secondaryKeywords": ["4-8 keyword strings"],
  "competitorNotes": ["3-5 notes about how to make this better than generic coverage"],
  "internalNotes": "optional notes; never invent technical details",
  "plannedClaims": [{"claim":"narrow factual claim","evidenceSourceIds":["S1"],"supportLevel":"direct"}]
}

Every planned claim MUST be directly or explicitly supported by a source's evidence array. If evidence is insufficient, omit the claim. Do not plan unsupported benefits, advice, problems, or implementation details.`;
}

function fallbackPlan(topic: string, category: string, evidenceSummary: string): PlanningResult {
  const primaryKeyword = topic.toLowerCase().split(":")[0].slice(0, 80);
  return {
    searchIntent: `Understand the practical developer impact of ${topic}.`,
    audience: `${category} developers and technical decision makers`,
    angle: `Explain ${topic} through implementation impact, tradeoffs, and next steps for developers.`,
    primaryKeyword,
    secondaryKeywords: [category.toLowerCase(), "developer guide", "technical analysis", primaryKeyword],
    competitorNotes: [
      "Focus on practical implementation details.",
      "Separate confirmed facts from interpretation.",
      "Include actionable takeaways for engineering teams.",
    ],
    internalNotes: evidenceSummary,
    plannedClaims: [],
  };
}

export async function generateContentPlan(
  topic: string,
  category: string,
  score: number,
  evidenceSummary: string,
  evidenceSources: unknown[] = []
): Promise<{ plan: PlanningResult; usage: { promptTokens: number; completionTokens: number }; model: string }> {
  if (!isVertexConfigured) {
    return {
      plan: fallbackPlan(topic, category, evidenceSummary),
      usage: { promptTokens: 0, completionTokens: 0 },
      model: "fallback",
    };
  }

  const model = await getSetting(MODEL_SETTING_KEYS.planning, env.VERTEX_FLASH);
  const result = await generateVertexJson<unknown>(model, buildPrompt(topic, category, score, evidenceSummary, evidenceSources));
  const parsed = PlanningResultSchema.safeParse(result.data);
  if (!parsed.success) {
    log.warn(`Planning response failed schema validation, using fallback: ${parsed.error.message}`);
    return {
      plan: fallbackPlan(topic, category, evidenceSummary),
      usage: result.usage,
      model: "fallback",
    };
  }
  return { plan: parsed.data, usage: result.usage, model };
}
