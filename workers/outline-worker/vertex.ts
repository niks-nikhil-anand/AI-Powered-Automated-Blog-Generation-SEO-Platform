import { env, isVertexConfigured } from "../shared/env";
import { generateVertexJson, slugify } from "../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../shared/settings";
import { logger } from "../shared/logger";
import { OutlineResult, OutlineResultSchema } from "./types";
import { containsKeyword, ensureKeywordInTitle } from "../shared/seo-keyword";

const log = logger.child({ worker: "outline-worker" });

type PlanInput = {
  searchIntent: string;
  audience: string;
  angle: string;
  primaryKeyword: string;
  secondaryKeywords: unknown;
  competitorNotes: unknown;
  plannedClaims?: unknown;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export type OutlineSpec = {
  /**
   * BlogInput.focusKeyword. The article contract requires it verbatim in the
   * H1 and in at least one H2, and both of those come from this outline -
   * the writer only renders the structure it is given.
   */
  focusKeyword?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  contentLength?: number | null;
  /** True when the submission carries reference sources to ground claims in. */
  sourced: boolean;
};

function buildPrompt(topic: string, category: string, plan: PlanInput, spec: OutlineSpec): string {
  const claimsKey = spec.sourced
    ? `, "claims": [{"text":"exact factual claim","evidenceSourceIds":["S1"]}]`
    : "";
  const claimsRule = spec.sourced
    ? `Every factual section must include claims drawn from the supplied planned claims, each mapped to its evidence source id.`
    : `This submission has no reference sources: omit "claims" entirely and keep every bullet conceptual or instructional rather than a checkable factual assertion.`;
  const focusKeywordRule = spec.focusKeyword
    ? `
Focus keyword: "${spec.focusKeyword}" (mandatory placement - the article is rejected automatically when this is missing):
- "title" and "metaTitle" MUST contain "${spec.focusKeyword}" verbatim.
- At least one section "heading" MUST contain "${spec.focusKeyword}" verbatim.
- Use the exact phrase; a reworded variant does not count.`
    : "";
  const editorMeta = [
    spec.metaTitle ? `Meta title (editor-specified, use verbatim): ${spec.metaTitle}` : null,
    spec.metaDescription ? `Meta description (editor-specified, use verbatim): ${spec.metaDescription}` : null,
    spec.contentLength ? `Target article length: ${spec.contentLength} words - size the section count accordingly` : null,
  ].filter(Boolean).join("\n");

  return `You are a senior technical editor creating an SEO article outline.

Topic: ${topic}
Category: ${category}
Search intent: ${plan.searchIntent}
Audience: ${plan.audience}
Angle: ${plan.angle}
Primary keyword: ${plan.primaryKeyword}
Secondary keywords: ${asStringArray(plan.secondaryKeywords).join(", ")}
Competitor notes: ${asStringArray(plan.competitorNotes).join("; ")}
Evidence-backed planned claims: ${JSON.stringify(plan.plannedClaims ?? [])}
${editorMeta}${focusKeywordRule}

Return ONLY a JSON object with these keys:
{
  "title": "polished SEO article title under 70 characters",
  "slug": "url-safe slug",
  "metaTitle": "under 100 characters",
  "metaDescription": "under 160 characters",
  "sections": [
    { "heading": "H2 heading", "intent": "what this section achieves", "bullets": ["3-5 evidence-bounded bullet points"]${claimsKey} }
  ],
  "faqs": [
    { "question": "reader question", "answerIntent": "what the answer should cover" }
  ]
}

Create 4-7 sections and 3-5 FAQs. ${claimsRule} Never invent benefits, common problems, recommendations, commands, APIs, or implementation details you cannot justify from the brief above.

Structure rules:
- Every section must move the reader towards the search intent above. Do not add a section because it is a common blog heading, and never create a section to hold a keyword.
- Do not create a "Table of Contents", "Internal Linking" or "Call To Action" section.
- No two sections may cover the same ground. If two would overlap, merge them into one.
- Headings describe what the section contains, in plain language. Do not stuff keyword variations into them, and do not repeat the focus keyword across several headings.
- Size the outline to what the topic genuinely needs; a tight 4-section outline beats a padded 7-section one.`;
}

function fallbackOutline(topic: string, plan: PlanInput, spec: OutlineSpec): OutlineResult {
  const base = topic.length > 70 ? `${topic.slice(0, 67)}...` : topic;
  const title = ensureKeywordInTitle(base, spec.focusKeyword);
  return {
    title,
    slug: slugify(title),
    metaTitle: ensureKeywordInTitle(spec.metaTitle || title, spec.focusKeyword, { maxLength: 60 }),
    metaDescription: (spec.metaDescription || plan.angle || `A practical developer guide to ${topic}`).slice(0, 160),
    sections: [
      {
        heading: "Why This Matters",
        intent: "Explain the practical relevance of the topic.",
        bullets: ["Summarize the signal", "Identify who is affected", "Clarify the technical stakes"],
        claims: [],
      },
      {
        heading: "Technical Background",
        intent: "Give readers the context needed to understand the topic.",
        bullets: ["Define the core concepts", "Explain recent changes", "Connect to developer workflows"],
        claims: [],
      },
      {
        heading: "Implementation Considerations",
        intent: "Turn the topic into practical engineering guidance.",
        bullets: ["List tradeoffs", "Call out risks", "Suggest evaluation steps"],
        claims: [],
      },
      {
        heading: "Recommended Next Steps",
        intent: "Help readers act on the information.",
        bullets: ["Audit current usage", "Prototype safely", "Monitor ecosystem updates"],
        claims: [],
      },
    ],
    faqs: [
      { question: `What is ${topic}?`, answerIntent: "Define the topic in plain technical language." },
      { question: "Who should care about this?", answerIntent: "Identify the developer audience." },
      { question: "What should teams do next?", answerIntent: "Provide practical next steps." },
    ],
  };
}

/**
 * The contract's focus-keyword rules are satisfiable only by the outline:
 * the title becomes the article H1 and the section headings become its H2s.
 * The prompt asks for the placement; this guarantees it, so a model that
 * ignores the instruction costs a heading prefix rather than a failed
 * generation run. A heading is only rewritten when NO heading carries the
 * keyword, and never the introduction's.
 */
export function enforceFocusKeyword(outline: OutlineResult, focusKeyword?: string | null): OutlineResult {
  const keyword = focusKeyword?.trim();
  if (!keyword) return outline;

  const title = ensureKeywordInTitle(outline.title, keyword);
  const sections = Array.isArray(outline.sections) ? outline.sections : [];
  const headings = sections.map((section) => (typeof section.heading === "string" ? section.heading : ""));
  const alreadyCovered = headings.some((heading) => containsKeyword(heading, keyword));

  let patchedSections = sections;
  if (!alreadyCovered) {
    const target = sections.findIndex(
      (section, index) =>
        typeof section.heading === "string" &&
        section.heading.trim().length > 0 &&
        !(index === 0 && /intro|introduction/i.test(section.heading))
    );
    if (target !== -1) {
      patchedSections = sections.map((section, index) =>
        index === target ? { ...section, heading: ensureKeywordInTitle(section.heading, keyword) } : section
      );
      log.warn("Outline had no section heading carrying the focus keyword - heading prefixed", {
        focusKeyword: keyword,
        heading: sections[target].heading,
      });
    }
  }

  return {
    ...outline,
    title,
    slug: outline.slug || slugify(title),
    metaTitle: ensureKeywordInTitle(outline.metaTitle || title, keyword, { maxLength: 60 }),
    sections: patchedSections,
  };
}

export async function generateContentOutline(
  topic: string,
  category: string,
  plan: PlanInput,
  spec: OutlineSpec
): Promise<{ outline: OutlineResult; usage: { promptTokens: number; completionTokens: number }; model: string }> {
  if (!isVertexConfigured) {
    return {
      outline: enforceFocusKeyword(fallbackOutline(topic, plan, spec), spec.focusKeyword),
      usage: { promptTokens: 0, completionTokens: 0 },
      model: "fallback",
    };
  }

  const model = await getSetting(MODEL_SETTING_KEYS.outline, env.VERTEX_FLASH);
  const result = await generateVertexJson<unknown>(model, buildPrompt(topic, category, plan, spec));
  const parsed = OutlineResultSchema.safeParse(result.data);
  if (!parsed.success) {
    log.warn(`Outline response failed schema validation, using fallback: ${parsed.error.message}`);
    return {
      outline: enforceFocusKeyword(fallbackOutline(topic, plan, spec), spec.focusKeyword),
      usage: result.usage,
      model: "fallback",
    };
  }
  return {
    outline: enforceFocusKeyword({ ...parsed.data, slug: parsed.data.slug || slugify(parsed.data.title) }, spec.focusKeyword),
    usage: result.usage,
    model,
  };
}
