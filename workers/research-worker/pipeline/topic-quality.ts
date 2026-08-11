import { z } from "zod";
import { env, isVertexConfigured } from "../../shared/env";
import { generateVertexJson } from "../../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../../shared/settings";
import { recordAIUsage, timed } from "../../shared/pricing";
import { logger } from "../../shared/logger";
import { researchConfig } from "../config";
import { ResearchCandidate, TopicQuality } from "../types";
import { extractEntities } from "../utils/similarity";
import { normalizeText } from "../utils/text";

const log = logger.child({ worker: "research-worker", stage: "topic-quality" });

/**
 * Topic Quality (docs/RESEARCH_ENGINE_UPGRADE.md Phase 7) - a deliberate,
 * SEPARATE signal from raw trend strength. A topic can be viral and still be a
 * bad article ("AI is changing software development": high trend, ~zero
 * specificity). This score asks "is this actually a good developer-article
 * topic?" and is computed from deterministic heuristics by default, with an
 * optional batched LLM score blended in behind
 * RESEARCH_LLM_TOPIC_QUALITY_ENABLED.
 *
 * Heuristic sub-scores (each 0-100) reward the GOOD example from the brief
 * ("Microsoft's AI Unit Test Agent: How Automated Test Generation Works") and
 * penalize vagueness:
 *   specificity, technicalDepth, informationRichness, developerRelevance,
 *   explainerPotential, evergreenValue, practicalUsefulness.
 */

const TECH_TERMS = /\b(api|sdk|framework|library|runtime|compiler|database|query|algorithm|protocol|server|cli|ide|plugin|extension|deployment|container|kubernetes|docker|testing|test|benchmark|inference|transformer|llm|agent|vector|embedding|cache|queue|grpc|graphql|orm|migration|observability|ci|cd)\b/;
const DEV_AUDIENCE = /\b(developer|engineer|programmer|coding|code|software|devops|backend|frontend|full[- ]?stack|open source|github)\b/;
const PRACTICAL = /\b(how to|tutorial|guide|tool|tools|template|starter|boilerplate|cli|sdk|api|self[- ]?host|deploy|integrate|automate|workflow|open source)\b/;
const EXPLAINABLE = /\b(how|why|architecture|design|internals|under the hood|explained|works|mechanism|pipeline|model|engine|agent)\b/;
const VAGUE = /\b(is changing|the future of|everything you need to know|what you need to know|revolutioni[sz]ing|game[- ]?chang|in \d{4}:|top \d+ (ways|reasons|trends))\b/;
const NEWS_ONLY = /\b(stock|shares|earnings|ipo|acquires|lawsuit|sues|fired|layoffs?|dies|dead)\b/;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreSpecificity(title: string): number {
  const norm = normalizeText(title);
  let score = 20; // baseline for a non-empty title
  const entities = extractEntities(title);
  if (entities.length > 0) score += 30; // a named product/org/technology
  if (/\bv?\d+\.\d+/.test(title)) score += 12; // a concrete version
  if (TECH_TERMS.test(norm)) score += 18; // a concrete technical noun
  if (/[—:|–-]/.test(title)) score += 8; // explanatory subtitle structure
  const words = norm.split(" ").filter(Boolean).length;
  if (words >= 5 && words <= 14) score += 12; // substantive but not rambling
  if (VAGUE.test(norm)) score -= 45; // vague/listicle framing
  return clamp(score);
}

function scoreTechnicalDepth(norm: string): number {
  let score = 15;
  const techMatches = norm.match(new RegExp(TECH_TERMS, "g"))?.length ?? 0;
  score += Math.min(50, techMatches * 15);
  if (EXPLAINABLE.test(norm)) score += 20;
  if (/\b(how|architecture|internals|design|algorithm|benchmark)\b/.test(norm)) score += 15;
  return clamp(score);
}

function scoreInfoRichness(candidate: ResearchCandidate): number {
  let score = 10;
  score += Math.min(40, candidate.keywords.length * 5);
  score += Math.min(50, candidate.evidence.length * 10);
  return clamp(score);
}

function scoreDeveloperRelevance(norm: string): number {
  let score = 20;
  if (DEV_AUDIENCE.test(norm)) score += 35;
  if (TECH_TERMS.test(norm)) score += 25;
  if (/\b(open source|self[- ]?host|cli|sdk|api|framework|library)\b/.test(norm)) score += 20;
  return clamp(score);
}

function scoreExplainerPotential(norm: string): number {
  let score = 20;
  if (EXPLAINABLE.test(norm)) score += 40;
  if (TECH_TERMS.test(norm)) score += 20; // there's a mechanism to explain
  if (/\b(new|launch|release|announce|introduc)\b/.test(norm)) score += 20; // new thing to explain
  return clamp(score);
}

function scoreEvergreen(norm: string): number {
  let score = 55; // most technical explainers have some lasting value
  if (PRACTICAL.test(norm) || EXPLAINABLE.test(norm)) score += 25;
  if (NEWS_ONLY.test(norm)) score -= 45; // pure financial/legal news decays fast
  if (VAGUE.test(norm)) score -= 15;
  return clamp(score);
}

function scorePractical(norm: string): number {
  let score = 20;
  if (PRACTICAL.test(norm)) score += 45;
  if (/\b(github|open source|self[- ]?host|npm|pip|install)\b/.test(norm)) score += 25;
  if (TECH_TERMS.test(norm)) score += 10;
  return clamp(score);
}

/** Deterministic topic-quality total (no LLM). Weighted blend of sub-scores. */
export function heuristicTopicQuality(candidate: ResearchCandidate): TopicQuality {
  const title = candidate.title;
  const norm = normalizeText(title);
  const specificity = scoreSpecificity(title);
  const technicalDepth = scoreTechnicalDepth(norm);
  const informationRichness = scoreInfoRichness(candidate);
  const developerRelevance = scoreDeveloperRelevance(norm);
  const explainerPotential = scoreExplainerPotential(norm);
  const evergreenValue = scoreEvergreen(norm);
  const practicalUsefulness = scorePractical(norm);

  const total = clamp(
    specificity * 0.2 +
      technicalDepth * 0.15 +
      informationRichness * 0.1 +
      developerRelevance * 0.15 +
      explainerPotential * 0.15 +
      evergreenValue * 0.1 +
      practicalUsefulness * 0.15
  );

  return {
    specificity,
    technicalDepth,
    informationRichness,
    developerRelevance,
    explainerPotential,
    evergreenValue,
    practicalUsefulness,
    llmQuality: 0,
    total,
  };
}

const LlmQualitySchema = z.object({
  scores: z.array(z.object({ topic: z.string(), quality: z.number(), reason: z.string().optional() })),
});

/**
 * Optional batched LLM topic-quality pass, blended 50/50 with the heuristic
 * total. One Vertex call for the whole pool keeps cost bounded and is recorded
 * via recordAIUsage. Fail-soft: returns an empty map (heuristic stands) on any
 * problem. Only runs when RESEARCH_LLM_TOPIC_QUALITY_ENABLED is on.
 */
export async function llmTopicQuality(candidates: ResearchCandidate[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!researchConfig.engine.llmTopicQualityEnabled || !isVertexConfigured || candidates.length === 0) {
    return out;
  }

  const model = await getSetting(MODEL_SETTING_KEYS.semantic, env.VERTEX_FLASH);
  const list = candidates.map((c, i) => `${i}. ${c.title}`).join("\n");
  const prompt = `You are a senior developer-blog editor. For each numbered candidate topic, score how good a DEVELOPER ARTICLE it would make (0-100): specific, technically substantive, explainable, and useful to working engineers. Score LOW for vague trend pieces ("AI is changing software development") and HIGH for concrete, explainable topics ("Microsoft's AI Unit Test Agent: How Automated Test Generation Works").

Candidates:
${list}

Return ONLY JSON: { "scores": [ { "topic": "<exact title>", "quality": 0-100, "reason": "short" } ] } with one entry per candidate.`;

  try {
    const { result, latencyMs } = await timed(() =>
      generateVertexJson<unknown>(model, prompt, { timeoutMs: researchConfig.semanticTimeoutMs })
    );
    await recordAIUsage({ worker: "research-worker", model, usage: result.usage, latencyMs });
    const parsed = LlmQualitySchema.safeParse(result.data);
    if (!parsed.success) {
      log.warn("LLM topic-quality returned invalid shape, using heuristic only", { error: parsed.error.message });
      return out;
    }
    const indexByTitle = new Map(candidates.map((c, i) => [c.title, i] as const));
    for (const s of parsed.data.scores) {
      const index = indexByTitle.get(s.topic);
      if (index !== undefined) out.set(index, clamp(s.quality));
    }
  } catch (error) {
    log.warn("LLM topic-quality failed, using heuristic only", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return out;
}

/** Blend heuristic + optional LLM quality into the final TopicQuality. */
export function blendTopicQuality(base: TopicQuality, llmQuality: number): TopicQuality {
  if (llmQuality <= 0) return base;
  return { ...base, llmQuality, total: clamp(base.total * 0.5 + llmQuality * 0.5) };
}
