import { z } from "zod";

/**
 * Shared type + parser for Trend.evidenceArticles
 * (ENHANCEMENT_IMPLEMENTATION_PLAN.md Task 1). Lives in workers/shared so
 * research-worker (writes it), writing-worker (Task 2 grounding) and
 * quality-worker (Task 3 fact-check) all parse the same Prisma Json column
 * through one Zod schema - a shape change can't drift between the producer
 * and the consumers.
 */
export const EvidenceArticleSchema = z.object({
  url: z.string().min(1),
  title: z.string(),
  excerpt: z.string().min(1),
  fetchedAt: z.string(),
  extractor: z.string(),
  chars: z.number(),
});

export type EvidenceArticle = z.infer<typeof EvidenceArticleSchema>;

/**
 * Parse the untyped Prisma Json column. Returns [] for anything that isn't
 * a well-formed array of articles (null, pre-Task-1 rows, partial writes) -
 * callers always get a safe empty list, never an exception.
 */
export function parseEvidenceArticles(value: unknown): EvidenceArticle[] {
  if (!Array.isArray(value)) return [];
  const parsed = z.array(EvidenceArticleSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}
