import { Worker } from "bullmq";
import { marked } from "marked";
import { imageQueue, QUEUE_NAMES, type WritingJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { generateBlogDraft } from "./vertex";
import { logger } from "../shared/logger";
import { env, isVertexConfigured } from "../shared/env";
import { workerOptions } from "../shared/worker-options";
import { attachUsageToBlog, recordAIUsage } from "../shared/pricing";
import { AI_BYLINE } from "../shared/branding";
import {
  assertGate,
  failWorkerAttempt,
  passWorkerAttempt,
  startWorkerAttempt,
  type QualityGateReport,
  QualityGateError,
} from "../shared/recovery";

const log = logger.child({ worker: "writing-worker" });

const DEFAULT_CATEGORY_SLUG = "general";

async function getOrCreateCategory(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || DEFAULT_CATEGORY_SLUG;
  const existing = await prisma.category.findUnique({ where: { slug } });
  if (existing) return existing;
  return prisma.category.create({ data: { name, slug } });
}

/**
 * excludeBlogId lets a retry for the same trend keep its own slug instead
 * of colliding with itself - without it, upserting on trendId with an
 * unchanged title would find the row's own existing slug via findUnique
 * and bump it to "-1" for no reason.
 */
async function uniqueSlug(base: string, excludeBlogId?: string, maxAttempts = 100): Promise<string> {
  const safeBase = base || "untitled";
  let slug = safeBase;
  let suffix = 0;
  while (true) {
    const existing = await prisma.blog.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === excludeBlogId) break;
    suffix += 1;
    if (suffix >= maxAttempts) {
      throw new Error(`Failed to generate unique slug after ${maxAttempts} attempts for base "${safeBase}"`);
    }
    slug = `${safeBase}-${suffix}`;
  }
  return slug;
}

/** Rough placeholder quality score until Worker 6 (quality-worker) exists. */
function heuristicScore(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  let score = 60;
  if (words >= env.BLOG_MIN_WORDS) score += 15;
  if (/```/.test(markdown)) score += 10;
  if (/\|.+\|/.test(markdown)) score += 10; // has a markdown table
  if (/##\s+faq/i.test(markdown)) score += 5;
  return Math.min(100, score);
}

function extractEvidenceUrls(evidenceSummary?: string | null): string[] {
  if (!evidenceSummary) return [];
  const matches = evidenceSummary.match(/https?:\/\/[^\s)]+/g) ?? [];
  return Array.from(new Set(matches.map((url) => url.replace(/[.,)]+$/, ""))));
}

/**
 * At least N citations to the trend's actual evidence URLs, not just any
 * external link (see IMPLEMENTATION_PLAN.md Phase 2.3). Skips the check
 * entirely when the trend has no evidence to cite (e.g. it predates the
 * Phase 2.1 migration) - that's not the draft's fault.
 */
function citationCheck(markdown: string, evidenceSummary?: string | null): { ok: boolean; found: number; required: number } {
  const evidenceUrls = extractEvidenceUrls(evidenceSummary);
  if (evidenceUrls.length === 0) return { ok: true, found: 0, required: 0 };
  const required = Math.min(2, evidenceUrls.length);
  const found = evidenceUrls.filter((url) => markdown.includes(url)).length;
  return { ok: found >= required, found, required };
}

function writingGate(markdown: string, evidenceSummary?: string | null): QualityGateReport {
  const score = heuristicScore(markdown);
  const reasons: string[] = [];
  if (score < 90) reasons.push(`Heuristic writing score ${score} is below 90`);
  if (!/^#\s+/m.test(markdown)) reasons.push("Missing H1 title");
  if ((markdown.match(/^##\s+/gm) ?? []).length < 8) reasons.push("Missing required H2 sections");
  if (!/^##\s+FAQs?/im.test(markdown)) reasons.push("Missing FAQ section");
  if (!/call to action|cta/i.test(markdown)) reasons.push("Missing call to action");

  const citations = citationCheck(markdown, evidenceSummary);
  if (!citations.ok) {
    reasons.push(`Cites ${citations.found}/${citations.required} required evidence source URL(s), not just any external link`);
  }

  return {
    stage: "writing-worker",
    score: Math.min(score, reasons.length > 0 ? 89 : 100),
    passed: reasons.length === 0 && score >= 90,
    reasons: reasons.length > 0 ? reasons : ["Writing format and quality passed"],
  };
}

async function generateBlogForTrend(trendId: string, topic: string, description: string, outlineId?: string) {
  const attempt = await startWorkerAttempt({
    worker: "writing-worker",
    trendId,
    input: { trendId, topic, description, outlineId },
  });
  const trend = await prisma.trend.findUnique({ where: { id: trendId } });
  if (!trend) throw new Error(`Trend ${trendId} not found`);
  if (trend.score < env.RESEARCH_MIN_SCORE_TO_WRITE) {
    log.info(`Skipping blog generation for "${trend.topic}" because score ${Math.round(trend.score)} is below ${env.RESEARCH_MIN_SCORE_TO_WRITE}`, {
      trendId,
      score: trend.score,
    });
    const output = { trendId, skipped: true, reason: "score_below_write_threshold" };
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output,
      nextStage: "stopped",
    });
    return output;
  }
  const outline = outlineId
    ? await prisma.contentOutline.findUnique({
        where: { id: outlineId },
        include: { plan: true },
      })
    : await prisma.contentOutline.findUnique({
        where: { trendId },
        include: { plan: true },
      });

  log.info(`Generating blog for trend "${topic}"`, {
    trendId,
    outlineId: outline?.id,
    mode: isVertexConfigured ? "vertex" : "fallback",
  });

  try {
    const startedAt = Date.now();
    const draft = await generateBlogDraft(topic, description, {
      plan: outline?.plan,
      outline: outline
        ? {
            title: outline.title,
            metaTitle: outline.metaTitle,
            metaDescription: outline.metaDescription,
            sections: outline.sections,
            faqs: outline.faqs,
          }
        : undefined,
      evidenceSummary: trend.evidenceSummary ?? undefined,
    });
    const latencyMs = Date.now() - startedAt;

    // Record spend before the gate: a rejected draft still burned tokens.
    // draft.model is whatever vertex.ts actually called - which can now be a
    // dashboard override rather than env.VERTEX_MODEL, so it must come from
    // the draft, not be re-derived here.
    const usageRecord = await recordAIUsage({
      worker: "writing-worker",
      model: draft.model,
      usage: draft.usage,
      latencyMs,
      trendId,
    });

    const gate = writingGate(draft.markdown, trend.evidenceSummary);
    assertGate(gate);
    const html = await marked.parse(draft.markdown);
    // Upsert on trendId instead of always create - a retried write_blog job
    // for a trend that already has a Blog row (e.g. quality-worker's
    // recovery requeue) updates that row instead of creating a duplicate.
    // See IMPLEMENTATION_PLAN.md Phase 1.4.
    const existingBlogForTrend = await prisma.blog.findUnique({ where: { trendId }, select: { id: true } });
    const slug = await uniqueSlug(draft.slug, existingBlogForTrend?.id);
    const category = await getOrCreateCategory(trend.category || "General");
    const score = heuristicScore(draft.markdown);

    const seoData = {
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      keywords: draft.keywords,
      schema: {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: draft.title,
        keywords: draft.keywords.join(", "),
        // Disclosed AI authorship (IMPLEMENTATION_PLAN.md Phase 2.7) - nothing
        // renders this today since there's no frontend, but it's the kind of
        // field that's annoying to backfill later if one ever does happen.
        author: { "@type": "Organization", name: AI_BYLINE },
      },
      score,
    };

    const blog = await prisma.blog.upsert({
      where: { trendId },
      create: {
        trendId,
        title: draft.title,
        slug,
        excerpt: draft.excerpt,
        content: draft.markdown,
        html,
        categoryId: category.id,
        status: "DRAFT",
        byline: AI_BYLINE,
        seo: { create: seoData },
      },
      update: {
        title: draft.title,
        slug,
        excerpt: draft.excerpt,
        content: draft.markdown,
        html,
        categoryId: category.id,
        status: "DRAFT",
        seo: { upsert: { create: seoData, update: seoData } },
      },
    });

    await attachUsageToBlog(usageRecord.id, blog.id);

    await prisma.trend.update({ where: { id: trendId }, data: { status: "PROCESSED" } });
    await imageQueue.add("generate_blog_image", {
      blogId: blog.id,
      trendId,
      title: blog.title,
      slug: blog.slug,
      category: category.name,
      excerpt: draft.excerpt,
    });
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output: { blogId: blog.id, slug: blog.slug, score },
      qualityReport: gate,
      nextStage: "image-worker",
      blogId: blog.id,
    });

    log.info(`Blog created: ${blog.slug}`, { blogId: blog.id, score });
    return { blogId: blog.id, slug: blog.slug, score };
  } catch (err) {
    await failWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      error: err,
      qualityReport: err instanceof QualityGateError ? err.report : undefined,
    });
    throw err;
  }
}

export function startWritingWorker() {
  const worker = new Worker(
    QUEUE_NAMES.writing,
    async (job) => {
      const { trendId, topic, description, outlineId } = job.data as WritingJobPayload;
      return generateBlogForTrend(trendId, topic, description, outlineId);
    },
    workerOptions(1)
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  log.info(`Writing worker listening on "${QUEUE_NAMES.writing}"`);
  return worker;
}

if (require.main === module) {
  startWritingWorker();
}
