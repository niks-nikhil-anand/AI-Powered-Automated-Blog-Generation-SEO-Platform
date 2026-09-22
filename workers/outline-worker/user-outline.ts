import { z } from "zod";
import { normalizeOutlineClaims } from "../shared/evidence-claims";
import type { OutlineResult } from "./types";
import { ensureKeywordInTitle } from "../shared/seo-keyword";

/** Same rule as workers/shared/vertex.ts's slugify, inlined so this module stays free of the Vertex/Redis stack. */
function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

/**
 * The optional outline an editor can paste into /dashboard/blogs/new:
 *
 *   {
 *     "sections": [{ "heading": "...", "intent": "...", "bullets": ["..."] }],
 *     "faqs": [{ "question": "...", "answer": "..." }]
 *   }
 *
 * Only `sections[].heading` is genuinely required - the rest is filled in
 * below, because an editor sketching a structure should not have to write a
 * per-section "intent" line to be taken seriously. Anything that doesn't
 * parse is ignored (parseUserOutline returns null) and the outline worker
 * falls back to generating a structure, rather than failing the submission
 * over a malformed optional field.
 */
export const UserOutlineSchema = z.object({
  sections: z
    .array(
      z.object({
        heading: z.string().min(1),
        intent: z.string().optional(),
        description: z.string().optional(),
        bullets: z.array(z.string()).optional(),
        wordTarget: z.number().optional(),
        targetWords: z.number().optional(),
        /**
         * Brief-supplied section directives (app/dashboard/blogs/new/brief.ts
         * maps keyPoints -> bullets and avoidContent -> avoid). They travel
         * with the section so the writer receives them per section rather
         * than as one undifferentiated wall of instructions.
         */
        readerQuestion: z.string().optional(),
        avoid: z.array(z.string()).optional(),
        requirements: z.array(z.string()).optional(),
        evidenceRequirements: z.array(z.string()).optional(),
        practicalExample: z.string().optional(),
        format: z.string().optional(),
        requiredInternalLink: z
          .object({ url: z.string(), anchor: z.string().optional() })
          .passthrough()
          .optional(),
        claims: z.array(z.unknown()).optional(),
        paragraphs: z
          .array(
            z
              .object({
                heading: z.string().min(1),
                discuss: z.array(z.string()).optional().default([]),
                keywords: z.array(z.string()).optional().default([]),
              })
              .passthrough()
          )
          .optional(),
        subsections: z
          .array(
            z
              .object({
                heading: z.string().min(1),
                discuss: z.array(z.string()).optional().default([]),
                keywords: z.array(z.string()).optional().default([]),
              })
              .passthrough()
          )
          .optional(),
        comparisonTable: z
          .object({
            columns: z.array(z.string()),
            rows: z.array(z.string()),
            instructions: z.string().optional(),
          })
          .passthrough()
          .optional(),
      }).passthrough()
    )
    .min(1),
  faqs: z
    .array(
      z.object({
        question: z.string().min(1),
        // Editors write the answer; the outline stores the answer's INTENT,
        // which is what the writing prompt consumes.
        answer: z.string().optional(),
        answerIntent: z.string().optional(),
      }).passthrough()
    )
    .optional(),
}).passthrough();

export type UserOutline = z.infer<typeof UserOutlineSchema>;

export function parseUserOutline(value: unknown): UserOutline | null {
  if (!value || typeof value !== "object") return null;
  const direct = UserOutlineSchema.safeParse(value);
  if (direct.success) return direct.data;
  const nested =
    (value as Record<string, unknown>).outlineJson ??
    (value as Record<string, unknown>).outline;
  if (nested && typeof nested === "object") {
    const nestedParsed = UserOutlineSchema.safeParse(nested);
    if (nestedParsed.success) return nestedParsed.data;
  }
  return null;
}

/**
 * Turn an editor-supplied outline into the OutlineResult shape the rest of
 * the pipeline already speaks, so the writing worker can't tell the
 * difference between a hand-written structure and a generated one.
 */
export function outlineFromUserInput(
  userOutline: UserOutline,
  meta: {
    title: string;
    metaTitle?: string | null;
    metaDescription?: string | null;
    angle: string;
    slug: string;
    /** BlogInput.focusKeyword - required verbatim in the article H1, which this title becomes. */
    focusKeyword?: string | null;
  }
): OutlineResult {
  const sections = userOutline.sections.map((section) => {
    const rawSubsections = section.paragraphs ?? section.subsections ?? [];
    const subsections = rawSubsections.map((sub) => ({
      heading: sub.heading,
      discuss: Array.isArray(sub.discuss) ? sub.discuss.map(String) : [],
      keywords: Array.isArray(sub.keywords) ? sub.keywords.map(String) : [],
    }));

    let bullets = section.bullets && section.bullets.length > 0 ? section.bullets : [];
    if (bullets.length === 0 && subsections.length > 0) {
      bullets = subsections.map((sub) =>
        sub.discuss.length > 0 ? `${sub.heading}: ${sub.discuss.join("; ")}` : sub.heading
      );
    }
    if (bullets.length === 0) {
      bullets = [section.heading];
    }

    return {
      heading: section.heading,
      intent: section.intent || section.description || `Cover "${section.heading}" for the reader.`,
      bullets,
      // Carried through verbatim - the writing worker renders each of these
      // into the section prompt.
      ...(section.readerQuestion ? { readerQuestion: section.readerQuestion } : {}),
      ...(section.avoid && section.avoid.length > 0 ? { avoid: section.avoid } : {}),
      ...(section.requirements && section.requirements.length > 0 ? { requirements: section.requirements } : {}),
      ...(section.evidenceRequirements && section.evidenceRequirements.length > 0
        ? { evidenceRequirements: section.evidenceRequirements }
        : {}),
      ...(section.practicalExample ? { practicalExample: section.practicalExample } : {}),
      ...(section.format ? { format: section.format } : {}),
      ...(section.requiredInternalLink ? { requiredInternalLink: section.requiredInternalLink } : {}),
      ...(section.wordTarget !== undefined || section.targetWords !== undefined
        ? { wordTarget: section.wordTarget ?? section.targetWords }
        : {}),
      claims: normalizeOutlineClaims(section.claims),
      subsections: subsections.length > 0 ? subsections : undefined,
      paragraphs: subsections.length > 0 ? subsections : undefined,
      comparisonTable: section.comparisonTable,
    };
  });

  // May legitimately be empty: OutlineResultSchema's `.min(1)` guards VERTEX
  // output, not an editor's deliberate choice. The writing worker's mandatory
  // skeleton emits an FAQs section either way.
  let faqs = (userOutline.faqs ?? []).map((faq) => ({
    question: faq.question,
    answerIntent: faq.answerIntent || faq.answer || `Answer "${faq.question}" directly and concretely.`,
  }));

  // If user supplied FAQs as an outline section instead of the faqs array, extract them
  if (faqs.length === 0) {
    const faqSection = userOutline.sections.find((s) => /faq|frequently asked/i.test(s.heading));
    const faqSubsections = faqSection?.paragraphs ?? faqSection?.subsections ?? [];
    if (faqSubsections.length > 0) {
      faqs = faqSubsections.map((sub) => ({
        question: sub.heading,
        answerIntent:
          Array.isArray(sub.discuss) && sub.discuss.length > 0
            ? sub.discuss.join(". ")
            : `Answer "${sub.heading}" directly and concretely.`,
      }));
    }
  }

  // The editor's section headings are theirs and are never rewritten here;
  // the outline worker logs when none of them carries the focus keyword, so
  // the H2 rule in the article contract is a visible editorial choice rather
  // than a silent structural edit.
  const title = ensureKeywordInTitle(meta.title, meta.focusKeyword);

  return {
    title,
    slug: meta.slug || slugify(title),
    metaTitle: ensureKeywordInTitle(meta.metaTitle || title, meta.focusKeyword, { maxLength: 60 }),
    metaDescription: (meta.metaDescription || meta.angle || meta.title).slice(0, 160),
    sections,
    faqs,
  };
}
