import { z } from "zod";

/**
 * Schema-validates generateContentOutline's Vertex response - see
 * IMPLEMENTATION_PLAN.md Phase 2.6. `slug` has no `.min(1)`: vertex.ts
 * already falls back to `slugify(title)` when the model returns an empty
 * slug, so an empty string here is a tolerated case, not a validation
 * failure.
 */
export const OutlineSectionSchema = z.object({
  heading: z.string().min(1),
  intent: z.string().min(1),
  bullets: z.array(z.string()).min(1),
  /**
   * Task 5 (optional, backward-compatible): per-section word target for
   * section-wise drafting, and the [S1]-style evidence markers this
   * section is expected to cite. Old outlines without these fields still
   * validate - the writing worker derives defaults when they're absent.
   */
  wordTarget: z.number().optional(),
  sourceMarkers: z.array(z.string()).optional(),
});

export const OutlineFaqSchema = z.object({
  question: z.string().min(1),
  answerIntent: z.string().min(1),
});

export const OutlineResultSchema = z.object({
  title: z.string().min(1),
  slug: z.string(),
  metaTitle: z.string().min(1),
  metaDescription: z.string().min(1),
  sections: z.array(OutlineSectionSchema).min(1),
  faqs: z.array(OutlineFaqSchema).min(1),
});

export type OutlineSection = z.infer<typeof OutlineSectionSchema>;
export type OutlineFaq = z.infer<typeof OutlineFaqSchema>;
export type OutlineResult = z.infer<typeof OutlineResultSchema>;
