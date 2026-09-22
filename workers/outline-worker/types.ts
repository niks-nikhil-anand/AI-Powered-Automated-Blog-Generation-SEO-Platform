import { z } from "zod";

export const OutlineClaimSchema = z.object({
  text: z.string().min(1),
  evidenceSourceIds: z.array(z.string().min(1)).min(1),
});

export const OutlineSubsectionSchema = z.object({
  heading: z.string().min(1),
  discuss: z.array(z.string()).optional().default([]),
  keywords: z.array(z.string()).optional().default([]),
}).passthrough();

export const OutlineComparisonTableSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.string()),
  instructions: z.string().optional(),
}).passthrough();

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
  sourceMarkers: z.array(z.string().regex(/^S\d+$/)).optional(),
  /** Brief-supplied per-section directives; see outline-worker/user-outline.ts. */
  readerQuestion: z.string().optional(),
  avoid: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
  evidenceRequirements: z.array(z.string()).optional(),
  practicalExample: z.string().optional(),
  format: z.string().optional(),
  requiredInternalLink: z.object({ url: z.string(), anchor: z.string().optional() }).passthrough().optional(),
  /**
   * Required only for SOURCED submissions (the ones carrying reference
   * articles): outline-worker's evidence gate then insists every section
   * carries at least one claim mapped to a real source. An unsourced
   * submission has nothing to map claims to, so an empty array is the
   * correct answer there and the gate skips the check entirely.
   */
  claims: z.array(OutlineClaimSchema).default([]),
  subsections: z.array(OutlineSubsectionSchema).optional(),
  paragraphs: z.array(OutlineSubsectionSchema).optional(),
  comparisonTable: OutlineComparisonTableSchema.optional(),
}).passthrough();

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
