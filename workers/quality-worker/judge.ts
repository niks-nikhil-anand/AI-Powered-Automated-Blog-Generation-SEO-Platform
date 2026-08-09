import { z } from "zod";
import { env, isVertexConfigured } from "../shared/env";
import { generateVertexJson } from "../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../shared/settings";
import { logger } from "../shared/logger";

const log = logger.child({ worker: "quality-worker", stage: "judge" });

/**
 * LLM editorial judge (ENHANCEMENT_IMPLEMENTATION_PLAN.md Task 4). The 11
 * regex/heuristic checks in scorer.ts measure an article's *shape*; this
 * judge measures its *substance* against the plan's stated intent, and -
 * just as importantly - returns machine-actionable fixes that the writing
 * worker's targeted-repair path (Task 5) consumes directly, ending the era
 * of blind full rewrites on "Readability: 6/10".
 *
 * Fail-soft contract identical to factcheck.ts: any misconfiguration,
 * call failure, or invalid response returns null and the scorer degrades
 * to heuristic-only scoring.
 */
export type JudgeFix = {
  /** Exact H2 heading text from the article - the repair splice target. */
  section: string;
  issue: string;
  fix: string;
  priority: "high" | "medium" | "low";
};

export type JudgeScores = {
  depth: number;
  accuracyOfTone: number;
  originality: number;
  usefulness: number;
};

export type JudgeResult = {
  scores: JudgeScores;
  /** 0-100 holistic score, weighted into overallScore by the scorer. */
  overall: number;
  critique: string;
  fixes: JudgeFix[];
  usage: { promptTokens: number; completionTokens: number };
  model: string;
};

const JudgeFixSchema = z.object({
  section: z.string().min(1),
  issue: z.string().min(1),
  fix: z.string().min(1),
  priority: z.enum(["high", "medium", "low"]),
});

const JudgeResponseSchema = z.object({
  scores: z.object({
    depth: z.number(),
    accuracyOfTone: z.number(),
    originality: z.number(),
    usefulness: z.number(),
  }),
  critique: z.string().min(1),
  fixes: z.array(JudgeFixSchema),
});

export type JudgeableBlog = {
  title: string;
  content: string;
  plan?: { searchIntent: string; audience: string; angle: string } | null;
};

function clamp10(value: number): number {
  return Math.max(0, Math.min(10, value));
}

function buildJudgePrompt(blog: JudgeableBlog): string {
  const planBlock = blog.plan
    ? `Search intent: ${blog.plan.searchIntent}
Target audience: ${blog.plan.audience}
Editorial angle: ${blog.plan.angle}`
    : "No content plan available - judge against the title's implied intent.";

  return `You are the editor-in-chief of a developer-focused technical blog, reviewing an article before publication. Judge substance, not formatting (a separate heuristic pass already checks structure, headings, links, and word counts - do not comment on those).

ARTICLE TITLE: ${blog.title}

CONTENT PLAN THE ARTICLE WAS WRITTEN AGAINST:
${planBlock}

Score four dimensions, 0-10 each:
1. depth - does the article teach something a competent developer couldn't skim from a changelog? Specifics, mechanisms, tradeoffs.
2. accuracyOfTone - are claims calibrated (confident where sourced, hedged where not)? Any overconfident or marketing-flavored passages?
3. originality - does it add an angle beyond generic coverage of this news, or is it a rewritten press release?
4. usefulness - judged against the search intent and audience above: will the target reader leave able to DO something?

Then list concrete fixes. Every fix MUST name the exact H2 heading it applies to (copy the heading text verbatim from the article), the issue, and what to change. Order by priority. If the article is excellent, return an empty fixes list - do not invent nits.

ARTICLE:
${blog.content}

Return ONLY JSON in this exact shape:
{
  "scores": { "depth": 0-10, "accuracyOfTone": 0-10, "originality": 0-10, "usefulness": 0-10 },
  "critique": "2-3 sentences summarizing the editorial assessment",
  "fixes": [{ "section": "exact H2 heading", "issue": "what is wrong", "fix": "what to change", "priority": "high"|"medium"|"low" }]
}`;
}

export async function judgeBlog(blog: JudgeableBlog): Promise<JudgeResult | null> {
  if (!isVertexConfigured) return null;

  try {
    const model = await getSetting(MODEL_SETTING_KEYS.judge, env.VERTEX_FLASH);
    const result = await generateVertexJson<unknown>(model, buildJudgePrompt(blog), { temperature: 0.2 });
    const parsed = JudgeResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      log.warn("Judge response failed schema validation, skipping judge dimension", { error: parsed.error.message });
      return null;
    }

    const scores: JudgeScores = {
      depth: clamp10(parsed.data.scores.depth),
      accuracyOfTone: clamp10(parsed.data.scores.accuracyOfTone),
      originality: clamp10(parsed.data.scores.originality),
      usefulness: clamp10(parsed.data.scores.usefulness),
    };
    const overall = Math.round(((scores.depth + scores.accuracyOfTone + scores.originality + scores.usefulness) / 40) * 100);

    return {
      scores,
      overall,
      critique: parsed.data.critique,
      fixes: parsed.data.fixes,
      usage: result.usage,
      model,
    };
  } catch (error) {
    log.warn("Judge call failed, skipping judge dimension", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
