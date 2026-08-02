import { env, isVertexConfigured } from "../shared/env";
import { generateVertexJson } from "../shared/vertex";
import { PlanningResult } from "./types";

function buildPrompt(topic: string, category: string, score: number, evidenceSummary: string): string {
  return `You are a senior SEO content strategist for a developer-focused technical blog.

Create a content plan for this research topic.

Topic: ${topic}
Category: ${category}
Research score: ${score}
Evidence:
${evidenceSummary}

Return ONLY a JSON object with these keys:
{
  "searchIntent": "reader intent in one sentence",
  "audience": "specific target reader",
  "angle": "clear original article angle",
  "primaryKeyword": "one primary keyword",
  "secondaryKeywords": ["4-8 keyword strings"],
  "competitorNotes": ["3-5 notes about how to make this better than generic coverage"],
  "internalNotes": "optional implementation guidance"
}`;
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
  };
}

export async function generateContentPlan(
  topic: string,
  category: string,
  score: number,
  evidenceSummary: string
): Promise<{ plan: PlanningResult; usage: { promptTokens: number; completionTokens: number }; model: string }> {
  if (!isVertexConfigured) {
    return {
      plan: fallbackPlan(topic, category, evidenceSummary),
      usage: { promptTokens: 0, completionTokens: 0 },
      model: "fallback",
    };
  }

  const result = await generateVertexJson<PlanningResult>(
    env.VERTEX_FLASH,
    buildPrompt(topic, category, score, evidenceSummary)
  );
  return { plan: result.data, usage: result.usage, model: env.VERTEX_FLASH };
}
