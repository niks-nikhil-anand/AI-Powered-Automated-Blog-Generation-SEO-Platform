import { z } from "zod";
import { normalizeSubmission } from "./brief";

/**
 * The manual blog specification - the single entry point of the pipeline.
 * Shared verbatim by the form (client), the server action and
 * POST /api/blogs/input, so the browser and the API can never disagree
 * about what a valid submission is.
 */
export const TONES = ["professional", "casual", "technical"] as const;
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const CATEGORIES = [
  { value: "tech", label: "Technology" },
  { value: "business", label: "Business" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "education", label: "Education" },
  { value: "security", label: "Security" },
  { value: "ai", label: "AI & ML" },
] as const;

const evidenceIdsSchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;
  return value.map(String).map((id) => id.trim()).filter(Boolean);
}, z.array(z.string().min(1)).min(1));

export const plannedClaimSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    claim: typeof record.claim === "string" ? record.claim : record.text,
    evidenceSourceIds: Array.isArray(record.evidenceSourceIds) ? record.evidenceSourceIds : record.sourceIds,
    supportLevel: record.supportLevel ?? "direct",
  };
}, z.object({
  claim: z.string().min(1),
  evidenceSourceIds: evidenceIdsSchema,
  supportLevel: z.enum(["direct", "supported"]).default("direct"),
}));

function plainUrl(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const markdownLink = value.match(/^\[(https?:\/\/[^\]]+)\]\((https?:\/\/[^)]+)\)$/);
  return markdownLink?.[2] ?? value;
}

const outlineClaimSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    text: typeof record.text === "string" ? record.text : record.claim,
    evidenceSourceIds: Array.isArray(record.evidenceSourceIds) ? record.evidenceSourceIds : record.sourceIds,
  };
}, z.object({
  text: z.string().min(1),
  evidenceSourceIds: evidenceIdsSchema,
}));

export const outlineParagraphSchema = z.object({
  heading: z.string().min(1),
  discuss: z.array(z.string()).optional().default([]),
  keywords: z.array(z.string()).optional().default([]),
}).passthrough();

export const outlineComparisonTableSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.string()),
  instructions: z.string().optional(),
}).passthrough();

export const outlineSectionSchema = z.object({
  heading: z.string().min(1),
  intent: z.string().optional(),
  description: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  wordTarget: z.number().optional(),
  targetWords: z.number().optional(),
  claims: z.array(outlineClaimSchema).optional(),
  paragraphs: z.array(outlineParagraphSchema).optional(),
  subsections: z.array(outlineParagraphSchema).optional(),
  comparisonTable: outlineComparisonTableSchema.optional(),
}).passthrough();

/**
 * Optional pre-structured outline. Only section headings are required - the
 * outline worker fills in intents and bullets it wasn't given (see
 * workers/outline-worker/user-outline.ts, which owns the same contract on
 * the worker side).
 */
export const outlineJsonSchema = z.object({
  sections: z.array(outlineSectionSchema).min(1),
  faqs: z
    .array(
      z.object({
        question: z.string().min(1),
        answer: z.string().optional(),
        answerIntent: z.string().optional(),
      }).passthrough()
    )
    .optional(),
}).passthrough();

/**
 * Optional reference sources. Supplying these switches the whole pipeline
 * into "sourced" mode: planning/outline must map every factual claim to one
 * of these sources, the writer cites them with [S1]-markers, and QA
 * fact-checks the draft against them. Leave it out for an unsourced brief
 * and those gates are skipped instead of failed.
 */
export const sourceSchema = z.object({
  url: z.preprocess(plainUrl, z.string().url()),
  title: z.string().min(1),
  /** Atomic, quotable facts. A title and URL alone are not evidence. */
  evidence: z.array(z.string().min(1)).default([]),
  excerpt: z.string().min(1).optional(),
  publisher: z.string().optional(),
  publishedAt: z.string().optional(),
});

function titleFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

const sourcesSchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;
  return value.map((source) => {
    if (typeof source !== "string") return source;
    const url = source.trim();
    return {
      url,
      title: titleFromUrl(url),
      evidence: [`Reference URL supplied by the editor: ${url}`],
    };
  });
}, z.array(sourceSchema));

export const generationInstructionsSchema = z
  .object({
    mustFollow: z.array(z.string()).optional(),
  })
  .passthrough();

export const blogInputSchema = z.preprocess((raw: unknown) => {
  // A nested authoring brief (schemaVersion "1.0") is mapped onto the flat
  // shape below before anything else runs; a flat submission passes through
  // unchanged. See ./brief.ts.
  const submission = normalizeSubmission(raw);
  if (submission && typeof submission === "object") {
    const obj = { ...(submission as Record<string, unknown>) };
    if (!obj.outlineJson && obj.outline && typeof obj.outline === "object") {
      obj.outlineJson = obj.outline;
    }
    if (!obj.focusKeyword && typeof obj.targetKeyword === "string") {
      obj.focusKeyword = obj.targetKeyword;
    }
    if (!obj.primaryKeywords && typeof obj.targetKeyword === "string") {
      obj.primaryKeywords = [obj.targetKeyword];
    }
    if (!obj.contentLength && typeof obj.targetWordCount === "number") {
      obj.contentLength = obj.targetWordCount;
    }
    if (!obj.audience && obj.generationInstructions && typeof obj.generationInstructions === "object") {
      const generationInstructions = obj.generationInstructions as Record<string, unknown>;
      if (typeof generationInstructions.audience === "string") obj.audience = generationInstructions.audience;
    }
    if (!obj.writingInstructions && obj.generationInstructions && typeof obj.generationInstructions === "object") {
      const generationInstructions = obj.generationInstructions as Record<string, unknown>;
      const instructions = [
        generationInstructions.writingStyle,
        ...(Array.isArray(generationInstructions.requirements) ? generationInstructions.requirements : []),
      ]
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean);
      if (instructions.length > 0) obj.writingInstructions = instructions;
    }
    return obj;
  }
  return submission;
}, z.object({
  title: z.string().min(10).max(200),
  slug: z.string().min(3).max(100).optional(),
  category: z.string().optional(),

  // SEO
  focusKeyword: z.string().optional(),
  primaryKeywords: z.array(z.string()).default([]),
  secondaryKeywords: z.array(z.string()).default([]),
  competitorKeywords: z.array(z.string()).optional(),
  longTailKeywords: z.array(z.string()).optional(),
  semanticKeywords: z.array(z.string()).optional(),
  metaTitle: z.string().max(100).optional(),
  metaDescription: z.string().max(160).optional(),

  // Content specs
  audience: z.string().optional(),
  searchIntent: z.string().optional(),
  tone: z.enum(TONES).default("professional"),
  contentLength: z.number().min(500).max(5000).default(2000),
  contentGoal: z.string().optional(),
  contentAngle: z.string().optional(),
  uniqueValueProposition: z.string().optional(),
  specs: z.record(z.string(), z.unknown()).optional(),
  internalLinks: z.array(z.string()).optional(),
  /**
   * Opt-ins to behaviour the global content rules switch off by default: a
   * table of contents, anchor navigation and links the editor has approved.
   * See workers/shared/editorial-policy.ts.
   */
  editorialPolicy: z
    .object({
      tableOfContents: z.boolean().optional(),
      anchorLinks: z.boolean().optional(),
      internalLinks: z.array(z.string()).optional(),
      /** URLs the brief vouched for: linkable without being research evidence. */
      approvedLinks: z.array(z.string()).optional(),
      externalLinks: z.enum(["evidence-only", "allowed"]).optional(),
      placeholderDomains: z.array(z.string()).optional(),
      strictLength: z.boolean().optional(),
    })
    .optional(),
  /** Brief context with no column of its own - rendered as its own prompt block. */
  briefDirectives: z.array(z.string()).optional(),
  /** Explicit word bounds from the brief; they override the derived range. */
  contentBounds: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      countFaqInTotal: z.boolean().optional(),
      avoidPadding: z.boolean().optional(),
    })
    .optional(),
  /** outlineJson.h1 - the article's H1 must match it verbatim. */
  briefedH1: z.string().optional(),
  /** What the brief -> submission mapping implies; informational only. */
  briefNotes: z.array(z.string()).optional(),
  /** generationConfig.generationMode - overrides the sectioned-writing default. */
  generationMode: z.string().optional(),
  /** generationConfig.maxSectionRetries - per-section retry budget. */
  maxSectionRetries: z.number().optional(),
  writingInstructions: z.array(z.string()).optional(),
  generationInstructions: generationInstructionsSchema.optional(),
  seoRequirements: z.record(z.string(), z.unknown()).optional(),
  publishing: z.record(z.string(), z.unknown()).optional(),

  // Optional: custom outline + reference sources
  outlineJson: outlineJsonSchema.optional(),
  sources: sourcesSchema.optional(),
  plannedClaims: z.array(plannedClaimSchema).optional(),

  // Scheduling
  priority: z.enum(PRIORITIES).default("NORMAL"),
  /**
   * true  - dispatch to the planning queue immediately on submit.
   * false - leave the row PENDING so the next publish slot (or the
   *         daily-target reconcile tick) picks it up at its scheduled time.
   */
  startNow: z.boolean().default(true),
}).passthrough());

export type BlogInputFormData = z.infer<typeof blogInputSchema>;

export type SubmitResult =
  | { success: true; id: string; status: string; message: string }
  | { success: false; error: string };

/** Mirrors workers/shared/blog-input.ts's slugifyTitle - keep the two in step. */
export function slugifyTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** "a, b , c" -> ["a","b","c"], dropping blanks so a trailing comma is harmless. */
export function splitKeywords(value: string): string[] {
  return value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}
