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
  id: z.string().min(1).optional(),
  url: z.string().min(1),
  title: z.string(),
  publisher: z.string().optional(),
  publishedAt: z.string().optional(),
  sourceType: z.string().optional(),
  reliabilityScore: z.number().optional(),
  /** Atomic, source-grounded facts. Never treat title/URL alone as evidence. */
  evidence: z.array(z.string().min(1)).default([]),
  unsupported: z.array(z.string()).optional(),
  excerpt: z.string().min(1),
  fetchedAt: z.string(),
  extractor: z.string(),
  chars: z.number(),
});

export type EvidenceArticle = z.infer<typeof EvidenceArticleSchema>;

export type EvidenceStrength = "direct" | "supported" | "weak" | "inferred" | "unsupported";

export type EvidenceSource = EvidenceArticle & { id: string; evidence: string[] };

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

/** Give legacy rows deterministic IDs while preserving their stored shape. */
export function canonicalEvidenceSources(value: unknown): EvidenceSource[] {
  return parseEvidenceArticles(value).map((article, index) => ({
    ...article,
    id: article.id ?? `S${index + 1}`,
    evidence: article.evidence,
  }));
}
