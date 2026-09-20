import { z } from "zod";
import type { OutlineResult } from "./types";

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
        bullets: z.array(z.string()).optional(),
        wordTarget: z.number().optional(),
      })
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
      })
    )
    .optional(),
});

export type UserOutline = z.infer<typeof UserOutlineSchema>;

export function parseUserOutline(value: unknown): UserOutline | null {
  if (!value || typeof value !== "object") return null;
  const parsed = UserOutlineSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Turn an editor-supplied outline into the OutlineResult shape the rest of
 * the pipeline already speaks, so the writing worker can't tell the
 * difference between a hand-written structure and a generated one.
 */
export function outlineFromUserInput(
  userOutline: UserOutline,
  meta: { title: string; metaTitle?: string | null; metaDescription?: string | null; angle: string; slug: string }
): OutlineResult {
  const sections = userOutline.sections.map((section) => ({
    heading: section.heading,
    intent: section.intent || `Cover "${section.heading}" for the reader.`,
    bullets: section.bullets && section.bullets.length > 0 ? section.bullets : [section.heading],
    ...(section.wordTarget !== undefined ? { wordTarget: section.wordTarget } : {}),
    claims: [],
  }));

  // May legitimately be empty: OutlineResultSchema's `.min(1)` guards VERTEX
  // output, not an editor's deliberate choice. The writing worker's mandatory
  // skeleton emits an FAQs section either way.
  const faqs = (userOutline.faqs ?? []).map((faq) => ({
    question: faq.question,
    answerIntent: faq.answerIntent || faq.answer || `Answer "${faq.question}" directly and concretely.`,
  }));

  return {
    title: meta.title,
    slug: meta.slug || slugify(meta.title),
    metaTitle: (meta.metaTitle || meta.title).slice(0, 60),
    metaDescription: (meta.metaDescription || meta.angle || meta.title).slice(0, 160),
    sections,
    faqs,
  };
}
