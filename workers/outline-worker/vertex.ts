import { env, isVertexConfigured } from "../shared/env";
import { generateVertexJson, slugify } from "../shared/vertex";
import { getSetting, MODEL_SETTING_KEYS } from "../shared/settings";
import { logger } from "../shared/logger";
import { OutlineResult, OutlineResultSchema } from "./types";

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
${editorMeta}

Return ONLY a JSON object with these keys:
{
  "title": "polished SEO article title under 70 characters",
  "slug": "url-safe slug",
  "metaTitle": "under 60 characters",
  "metaDescription": "under 160 characters",
  "sections": [
    { "heading": "H2 heading", "intent": "what this section achieves", "bullets": ["3-5 evidence-bounded bullet points"]${claimsKey} }
  ],
  "faqs": [
    { "question": "reader question", "answerIntent": "what the answer should cover" }
  ]
}

Create 5-8 sections and 3-5 FAQs. ${claimsRule} Never invent benefits, common problems, recommendations, commands, APIs, or implementation details you cannot justify from the brief above.`;
}

function fallbackOutline(topic: string, plan: PlanInput, spec: OutlineSpec): OutlineResult {
  const title = topic.length > 70 ? `${topic.slice(0, 67)}...` : topic;
  return {
    title,
    slug: slugify(title),
    metaTitle: (spec.metaTitle || title).slice(0, 60),
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

export async function generateContentOutline(
  topic: string,
  category: string,
  plan: PlanInput,
  spec: OutlineSpec
): Promise<{ outline: OutlineResult; usage: { promptTokens: number; completionTokens: number }; model: string }> {
  if (!isVertexConfigured) {
    return {
      outline: fallbackOutline(topic, plan, spec),
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
      outline: fallbackOutline(topic, plan, spec),
      usage: result.usage,
      model: "fallback",
    };
  }
  return {
    outline: { ...parsed.data, slug: parsed.data.slug || slugify(parsed.data.title) },
    usage: result.usage,
    model,
  };
}
