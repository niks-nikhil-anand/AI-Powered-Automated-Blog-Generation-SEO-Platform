import { Worker } from "bullmq";
import { marked } from "marked";
import { imageQueue, QUEUE_NAMES, type WritingJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { generateBlogDraft } from "./vertex";
import { logger } from "../shared/logger";
import { env, isVertexConfigured } from "../shared/env";
import { workerOptions } from "../shared/worker-options";
import { attachUsageToBlog, recordAIUsage } from "../shared/pricing";
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

async function uniqueSlug(base: string): Promise<string> {
  let slug = base || "untitled";
  let suffix = 0;
  while (await prisma.blog.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
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

function writingGate(markdown: string): QualityGateReport {
  const score = heuristicScore(markdown);
  const reasons: string[] = [];
  if (score < 90) reasons.push(`Heuristic writing score ${score} is below 90`);
  if (!/^#\s+/m.test(markdown)) reasons.push("Missing H1 title");
  if ((markdown.match(/^##\s+/gm) ?? []).length < 8) reasons.push("Missing required H2 sections");
  if (!/^##\s+FAQs?/im.test(markdown)) reasons.push("Missing FAQ section");
  if (!/call to action|cta/i.test(markdown)) reasons.push("Missing call to action");
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

    const gate = writingGate(draft.markdown);
    assertGate(gate);
    const html = await marked.parse(draft.markdown);
    const slug = await uniqueSlug(draft.slug);
    const category = await getOrCreateCategory(trend.category || "General");
    const score = heuristicScore(draft.markdown);

    const blog = await prisma.blog.create({
      data: {
        title: draft.title,
        slug,
        excerpt: draft.excerpt,
        content: draft.markdown,
        html,
        categoryId: category.id,
        status: "DRAFT",
        seo: {
          create: {
            metaTitle: draft.metaTitle,
            metaDescription: draft.metaDescription,
            keywords: draft.keywords,
            schema: {
              "@context": "https://schema.org",
              "@type": "TechArticle",
              headline: draft.title,
              keywords: draft.keywords.join(", "),
            },
            score,
          },
        },
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
