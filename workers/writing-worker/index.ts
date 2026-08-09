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
import { parseEvidenceArticles } from "../shared/evidence";
import {
  groundedCitationCheck,
  materializeCitations,
  toGroundedSources,
  type GroundedSource,
} from "./citations";
import {
  findSection,
  generateSection,
  joinSections,
  splitIntoSections,
  type SectionArticleContext,
  type SectionSpec,
} from "./sections";
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

function writingGate(
  markdown: string,
  evidenceSummary?: string | null,
  grounded?: { citedMarkers: string[]; sources: GroundedSource[] }
): QualityGateReport {
  const score = heuristicScore(markdown);
  const reasons: string[] = [];
  if (score < 90) reasons.push(`Heuristic writing score ${score} is below 90`);
  if (!/^#\s+/m.test(markdown)) reasons.push("Missing H1 title");
  if ((markdown.match(/^##\s+/gm) ?? []).length < 8) reasons.push("Missing required H2 sections");
  if (!/^##\s+FAQs?/im.test(markdown)) reasons.push("Missing FAQ section");
  if (!/call to action|cta/i.test(markdown)) reasons.push("Missing call to action");

  if (grounded) {
    // Task 2 path: markers were materialized into links by code, so this
    // checks marker coverage - robust to URL formatting differences the
    // legacy substring check below used to fail valid drafts over.
    const citations = groundedCitationCheck(grounded.citedMarkers, grounded.sources);
    if (!citations.ok) {
      reasons.push(`Cites ${citations.found}/${citations.required} required evidence source(s) via [S]-markers`);
    }
  } else {
    const citations = citationCheck(markdown, evidenceSummary);
    if (!citations.ok) {
      reasons.push(`Cites ${citations.found}/${citations.required} required evidence source URL(s), not just any external link`);
    }
  }

  return {
    stage: "writing-worker",
    score: Math.min(score, reasons.length > 0 ? 89 : 100),
    passed: reasons.length === 0 && score >= 90,
    reasons: reasons.length > 0 ? reasons : ["Writing format and quality passed"],
  };
}

/**
 * Task 5: targeted repair. When quality-worker requeues a blog with
 * actionable judgeFixes, regenerate ONLY the named sections and splice
 * them into the existing article - a 200-word problem no longer costs an
 * 8k-token full rewrite. Returns null when repair isn't applicable (no
 * blog row, too many fixes, or a fix that can't be mapped to a concrete
 * section = whole-article concern), and the caller falls through to the
 * normal full-draft path.
 */
async function attemptTargetedRepair(args: {
  trend: { id: string; evidenceSummary: string | null };
  topic: string;
  description: string;
  outline: { title: string; plan?: SectionArticleContext["plan"] } | null;
  groundedSources: GroundedSource[];
  judgeFixes: { section: string; issue: string; fix: string; priority: "high" | "medium" | "low" }[];
  attempt: { workflow: { id: string }; attempt: { id: string } };
}): Promise<{ blogId: string; slug: string; score: number } | null> {
  const { trend, topic, description, outline, groundedSources, judgeFixes, attempt } = args;
  if (judgeFixes.length === 0 || judgeFixes.length > 3) return null;

  const blog = await prisma.blog.findUnique({ where: { trendId: trend.id } });
  if (!blog) {
    log.info("Targeted repair skipped - no existing blog row, falling back to full rewrite", { trendId: trend.id });
    return null;
  }

  const sections = splitIntoSections(blog.content);
  const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
  const orderedFixes = [...judgeFixes].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Every fix must map to a concrete section - one unmatchable fix means
  // the judge is asking for whole-article work, which stays a full rewrite.
  const matched: { fix: (typeof judgeFixes)[number]; sectionIndex: number }[] = [];
  for (const fix of orderedFixes) {
    const sectionIndex = sections.findIndex((section) => section === findSection(sections, fix.section));
    if (sectionIndex === -1) {
      log.info("Judge fix targets an unmatched section, falling back to full rewrite", { trendId: trend.id, section: fix.section });
      return null;
    }
    matched.push({ fix, sectionIndex });
  }

  const startedAt = Date.now();
  const usageRecords: { model: string; usage: { promptTokens: number; completionTokens: number } }[] = [];
  const context: SectionArticleContext = {
    title: blog.title,
    topic,
    description,
    plan: outline?.plan,
    sources: groundedSources,
    keywords: [],
  };

  for (const { fix, sectionIndex } of matched) {
    const section = sections[sectionIndex];
    const existingWords = section.body.split(/\s+/).filter(Boolean).length;
    const spec: SectionSpec = {
      heading: section.heading,
      kind: "generic",
      intent: `Repair this section of a larger article. ${fix.fix}`,
      bullets: [],
      wordTarget: Math.max(80, existingWords),
    };
    const draft = await generateSection(spec, context, {
      repairNote: `The previous version of this section failed editorial review. Issue: ${fix.issue}. Required fix: ${fix.fix}.`,
    });
    usageRecords.push({ model: draft.model, usage: draft.usage });

    // Keep the ORIGINAL heading text no matter what the model emitted -
    // the quality scorer's requiredSections matching depends on it.
    let newBody = draft.markdown.trim();
    if (!newBody.startsWith("## ")) {
      newBody = `## ${section.heading}\n\n${newBody}`;
    } else {
      newBody = newBody.replace(/^##\s+.*$/m, `## ${section.heading}`);
    }
    section.body = `${newBody}\n`;
  }

  const joined = joinSections(sections);
  // Newly repaired sections may carry [S]-markers; previously written
  // sections already hold real links (idempotent - materialize only
  // touches marker tokens).
  const materialized = groundedSources.length > 0 ? materializeCitations(joined, groundedSources) : null;
  const markdown = materialized?.markdown ?? joined;

  let usageRecordId: string | null = null;
  const latencyShare = Math.round((Date.now() - startedAt) / Math.max(1, usageRecords.length));
  for (const record of usageRecords) {
    const saved = await recordAIUsage({ worker: "writing-worker", model: record.model, usage: record.usage, latencyMs: latencyShare, trendId: trend.id });
    if (!usageRecordId) usageRecordId = saved.id;
  }

  // Legacy URL citation check (not the marker check): repaired articles
  // carry already-materialized links, so verbatim-URL matching is the
  // correct verification here.
  const gate = writingGate(markdown, trend.evidenceSummary);
  assertGate(gate);

  const html = await marked.parse(markdown);
  await prisma.blog.update({
    where: { id: blog.id },
    data: { content: markdown, html, status: "DRAFT" },
  });
  if (usageRecordId) await attachUsageToBlog(usageRecordId, blog.id);

  // Image worker's featuredImageId skip makes this a pass-through to QA.
  await imageQueue.add("generate_blog_image", {
    blogId: blog.id,
    trendId: trend.id,
    title: blog.title,
    slug: blog.slug,
    category: "",
    excerpt: blog.excerpt ?? undefined,
  });
  await passWorkerAttempt({
    workflowRunId: attempt.workflow.id,
    attemptId: attempt.attempt.id,
    output: { blogId: blog.id, slug: blog.slug, score: gate.score, repairMode: "targeted", repairedSections: matched.map((m) => m.fix.section) },
    qualityReport: gate,
    nextStage: "image-worker",
    blogId: blog.id,
  });

  log.info(`Blog repaired via targeted section splice: ${blog.slug}`, {
    blogId: blog.id,
    sections: matched.map((m) => m.fix.section),
  });
  return { blogId: blog.id, slug: blog.slug, score: gate.score };
}

async function generateBlogForTrend(
  trendId: string,
  topic: string,
  description: string,
  outlineId?: string,
  recoveryContext?: WritingJobPayload["recoveryContext"]
) {
  const attempt = await startWorkerAttempt({
    worker: "writing-worker",
    trendId,
    input: { trendId, topic, description, outlineId },
  });
  const trend = await prisma.trend.findUnique({ where: { id: trendId } });
  if (!trend) throw new Error(`Trend ${trendId} not found`);
  // manuallyApproved lets a human-approved below-threshold trend (see
  // app/api/trends/[id]/approve) survive this gate the same way
  // planning-worker's and outline-worker's identical checks do.
  if (trend.score < env.RESEARCH_MIN_SCORE_TO_WRITE && !trend.manuallyApproved) {
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

  const priorReport = recoveryContext?.qualityReport as QualityGateReport | undefined;

  // Task 2: when the trend carries full-text evidence (Task 1) and the flag
  // is on, the draft grounds on [S1]-marked sources and citations are
  // materialized by code below. Trends without evidenceArticles keep the
  // legacy evidenceSummary path untouched.
  const evidenceArticles = parseEvidenceArticles(trend.evidenceArticles);
  const groundedSources: GroundedSource[] =
    env.GROUNDED_WRITING_ENABLED && evidenceArticles.length > 0 ? toGroundedSources(evidenceArticles) : [];

  try {
    // Task 5: targeted repair - when QA requeued this blog with actionable
    // judge fixes, splice-fix just those sections instead of paying for a
    // full rewrite. Returns null (falls through to full generation) when
    // repair isn't applicable - see attemptTargetedRepair's contract.
    if (env.TARGETED_REPAIR_ENABLED && (recoveryContext?.judgeFixes?.length ?? 0) > 0) {
      const repaired = await attemptTargetedRepair({
        trend,
        topic,
        description,
        outline,
        groundedSources,
        judgeFixes: recoveryContext?.judgeFixes ?? [],
        attempt,
      });
      if (repaired) return repaired;
    }

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
      evidenceSources: groundedSources.length > 0 ? groundedSources : undefined,
      priorAttempt: priorReport ? { score: priorReport.score, reasons: priorReport.reasons } : undefined,
      trendId,
    });
    const latencyMs = Date.now() - startedAt;

    // Task 2: convert [S1]-markers into real Markdown links BEFORE the gate
    // and before HTML rendering, so the stored content is the linked version
    // and the gate checks the marker coverage.
    let citationMeta: { citedMarkers: string[]; droppedMarkers: string[]; foreignLinks: string[] } | null = null;
    if (groundedSources.length > 0) {
      const materialized = materializeCitations(draft.markdown, groundedSources);
      draft.markdown = materialized.markdown;
      citationMeta = {
        citedMarkers: materialized.citedMarkers,
        droppedMarkers: materialized.droppedMarkers,
        foreignLinks: materialized.foreignLinks,
      };
      if (materialized.droppedMarkers.length > 0) {
        log.warn("Draft invented citation markers (stripped)", { trendId, droppedMarkers: materialized.droppedMarkers });
      }
      if (materialized.foreignLinks.length > 0) {
        // Soft signal only - logged for calibration, not a gate failure.
        log.warn("Draft links to non-evidence domains", { trendId, foreignLinks: materialized.foreignLinks });
      }
    }

    // Record spend before the gate: a rejected draft still burned tokens.
    // Task 5: sectioned drafts carry per-call usage rows - record each so
    // per-model rollups stay accurate (wall-clock latency is split evenly;
    // individual section latencies aren't separately measured). The legacy
    // monolithic path keeps its single aggregate row.
    let usageRecordId: string | null = null;
    if (draft.usageRecords && draft.usageRecords.length > 0) {
      const latencyShare = Math.round(latencyMs / draft.usageRecords.length);
      for (const record of draft.usageRecords) {
        const saved = await recordAIUsage({
          worker: "writing-worker",
          model: record.model,
          usage: record.usage,
          latencyMs: latencyShare,
          trendId,
        });
        if (!usageRecordId) usageRecordId = saved.id;
      }
    } else {
      const saved = await recordAIUsage({
        worker: "writing-worker",
        model: draft.model,
        usage: draft.usage,
        latencyMs,
        trendId,
      });
      usageRecordId = saved.id;
    }

    const gate = writingGate(
      draft.markdown,
      trend.evidenceSummary,
      groundedSources.length > 0 && citationMeta
        ? { citedMarkers: citationMeta.citedMarkers, sources: groundedSources }
        : undefined
    );
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

    await attachUsageToBlog(usageRecordId, blog.id);

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
      output: {
        blogId: blog.id,
        slug: blog.slug,
        score,
        grounded: groundedSources.length > 0,
        citations: citationMeta ?? undefined,
      },
      qualityReport: gate,
      nextStage: "image-worker",
      blogId: blog.id,
    });

    log.info(`Blog created: ${blog.slug}`, { blogId: blog.id, score, grounded: groundedSources.length > 0 });
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
      const { trendId, topic, description, outlineId, recoveryContext } = job.data as WritingJobPayload;
      return generateBlogForTrend(trendId, topic, description, outlineId, recoveryContext);
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
