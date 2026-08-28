import { Worker } from "bullmq";
import { marked } from "marked";
import { imageQueue, JOB_IDS, QUEUE_NAMES, type WritingJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { generateBlogDraft } from "./vertex";
import { logger } from "../shared/logger";
import { withPipelineRetryPolicy } from "../shared/pipeline-retry-policy";
import { withVertexTelemetryContext } from "../shared/vertex-telemetry-context";
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
  buildClaimRepairNote,
  findUnmarkedClaims,
  locateClaimSection,
  selfCheckClaims,
  SELFCHECK_PASS_SCORE,
  type SelfCheckIssue,
  type SelfCheckResult,
} from "./selfcheck";
import {
  assertGate,
  failWorkerAttempt,
  passWorkerAttempt,
  startWorkerAttempt,
  type QualityGateReport,
  QualityGateError,
} from "../shared/recovery";
import { logVertexRuntimeConfig } from "../shared/vertex";

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
  grounded?: { citedMarkers: string[]; sources: GroundedSource[] },
  factSafety?: { selfCheck: SelfCheckResult | null; unmarkedClaims: string[] }
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

  // Task 6.7: a draft that would be "Blocked - unverified facts" at QA
  // fails HERE instead, with the concrete claim list in the reasons - the
  // BullMQ retry's priorAttempt then carries specifics, not a bare score.
  // Fail-open when the self-check couldn't run (null), same philosophy as
  // the quality worker's own fact-check gate.
  if (factSafety?.selfCheck && factSafety.selfCheck.score < SELFCHECK_PASS_SCORE) {
    reasons.push(
      `Claim self-check score ${factSafety.selfCheck.score} is below ${SELFCHECK_PASS_SCORE} (the quality worker's fact-check threshold)`
    );
    for (const issue of factSafety.selfCheck.issues.slice(0, 5)) {
      reasons.push(`${issue.verdict} claim: "${issue.claim.slice(0, 140)}"${issue.note ? ` - ${issue.note}` : ""}`);
    }
  }
  if (factSafety && factSafety.unmarkedClaims.length > 0) {
    reasons.push(`${factSafety.unmarkedClaims.length} specific claim(s) lack an evidence marker`);
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
    evidenceSummary: trend.evidenceSummary ?? undefined,
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
  // Epoch-keyed jobId: each repair run gets a fresh ID so the QA re-score is
  // never deduped away against the original image job (see JOB_IDS docs).
  await imageQueue.add(
    "generate_blog_image",
    {
      blogId: blog.id,
      trendId: trend.id,
      title: blog.title,
      slug: blog.slug,
      category: "",
      excerpt: blog.excerpt ?? undefined,
    },
    { jobId: JOB_IDS.image(blog.id, attempt.attempt.id) }
  );
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

/**
 * Task 6.4: regenerate ONLY the sections holding failing claims and splice
 * them back - shared by the pre-persist repair (fresh drafts, markers
 * intact) and attemptClaimRepair (QA requeues, already-materialized
 * content). Returns null when the problem isn't section-local (no affected
 * section, > 3 affected sections, or a claim that can't be mapped to a
 * concrete section) - the caller then falls back to a full redraft/rewrite.
 */
async function repairSectionsWithClaims(args: {
  markdown: string;
  issues: SelfCheckIssue[];
  unmarkedClaims: string[];
  context: SectionArticleContext;
}): Promise<{
  markdown: string;
  usageRecords: { model: string; usage: { promptTokens: number; completionTokens: number } }[];
  repairedSections: string[];
} | null> {
  const { markdown, issues, unmarkedClaims, context } = args;
  const sections = splitIntoSections(markdown);

  // Group work by section. null heading = the preamble (H1 + intro).
  const targets = new Map<number, { issues: SelfCheckIssue[]; unmarked: string[] }>();
  const targetFor = (sectionHeading: string | null): number => sections.findIndex((section) => section.heading === sectionHeading);
  const addTo = (index: number, issue: SelfCheckIssue | null, unmarked: string | null) => {
    const entry = targets.get(index) ?? { issues: [], unmarked: [] };
    if (issue) entry.issues.push(issue);
    if (unmarked) entry.unmarked.push(unmarked);
    targets.set(index, entry);
  };

  for (const issue of issues) {
    const index = targetFor(issue.section);
    if (index === -1) {
      log.info("Claim issue targets an unmatched section, repair not section-local", { section: issue.section });
      return null;
    }
    addTo(index, issue, null);
  }
  for (const claim of unmarkedClaims) {
    const index = targetFor(locateClaimSection(markdown, claim));
    if (index === -1) return null;
    addTo(index, null, claim);
  }

  // Too many affected sections = a whole-article grounding problem, not a
  // splice - same contract as attemptTargetedRepair's >3-fixes guard.
  if (targets.size === 0 || targets.size > 3) return null;

  const usageRecords: { model: string; usage: { promptTokens: number; completionTokens: number } }[] = [];
  const repairedSections: string[] = [];
  for (const [index, group] of targets) {
    const section = sections[index];
    const existingWords = section.body.split(/\s+/).filter(Boolean).length;
    const spec: SectionSpec = {
      heading: section.heading,
      kind: section.heading === null ? "intro" : "generic",
      intent:
        section.heading === null
          ? "Repair the article introduction."
          : "Repair this section of a larger article so every specific claim is backed by the SOURCES.",
      bullets: [],
      wordTarget: Math.max(80, existingWords),
    };
    const draft = await generateSection(spec, context, {
      repairNote: buildClaimRepairNote(group.issues, group.unmarked),
    });
    usageRecords.push({ model: draft.model, usage: draft.usage });

    let newBody = draft.markdown.trim();
    if (section.heading === null) {
      // The preamble holds the H1 title - regenerating the intro must not
      // lose it. Strip any heading the model emitted despite the intro
      // instructions, then re-attach the original H1.
      const h1Line = section.body.match(/^#\s+.*$/m)?.[0] ?? null;
      newBody = newBody.replace(/^#{1,2}\s+.*$/m, "").trim();
      section.body = h1Line ? `${h1Line}\n\n${newBody}\n` : `${newBody}\n`;
    } else {
      // Keep the ORIGINAL heading text no matter what the model emitted -
      // the quality scorer's requiredSections matching depends on it.
      if (!newBody.startsWith("## ")) {
        newBody = `## ${section.heading}\n\n${newBody}`;
      } else {
        newBody = newBody.replace(/^##\s+.*$/m, `## ${section.heading}`);
      }
      section.body = `${newBody}\n`;
    }
    repairedSections.push(section.heading ?? "Introduction");
  }

  return { markdown: joinSections(sections), usageRecords, repairedSections };
}

/**
 * Task 6: when quality-worker requeues a blog specifically because the
 * fact check couldn't verify concrete claims (recoveryContext.factCheckIssues,
 * Task 6.1), splice-fix just the affected sections instead of the blind
 * full rewrite that used to hallucinate fresh claims every attempt.
 * Returns null (falls through to full generation) when repair isn't
 * applicable - no blog row, too many issues, or an unmappable claim.
 */
async function attemptClaimRepair(args: {
  trend: { id: string; evidenceSummary: string | null };
  topic: string;
  description: string;
  outline: { title: string; plan?: SectionArticleContext["plan"] } | null;
  groundedSources: GroundedSource[];
  factCheckIssues: { claim: string; verdict: string; note?: string }[];
  attempt: { workflow: { id: string }; attempt: { id: string } };
}): Promise<{ blogId: string; slug: string; score: number } | null> {
  const { trend, topic, description, outline, groundedSources, factCheckIssues, attempt } = args;
  if (factCheckIssues.length === 0 || factCheckIssues.length > 10) return null;
  if (!isVertexConfigured) return null;

  const blog = await prisma.blog.findUnique({ where: { trendId: trend.id } });
  if (!blog) {
    log.info("Claim repair skipped - no existing blog row, falling back to full rewrite", { trendId: trend.id });
    return null;
  }

  // QA's claims were extracted from the stored (materialized) content, so
  // they substring-match it directly. A claim that maps to no section is a
  // whole-article concern - full rewrite.
  const validVerdicts = new Set(["unsupported", "uncertain", "unverifiable"]);
  const issues: SelfCheckIssue[] = [];
  for (const issue of factCheckIssues) {
    const section = locateClaimSection(blog.content, issue.claim);
    if (section === null && !splitIntoSections(blog.content).some((s) => s.heading === null)) {
      log.info("Fact-check issue not locatable in the article, falling back to full rewrite", { trendId: trend.id });
      return null;
    }
    issues.push({
      claim: issue.claim,
      verdict: validVerdicts.has(issue.verdict) ? (issue.verdict as SelfCheckIssue["verdict"]) : "unverifiable",
      note: issue.note,
      section,
    });
  }

  const startedAt = Date.now();
  const context: SectionArticleContext = {
    title: blog.title,
    topic,
    description,
    plan: outline?.plan,
    sources: groundedSources,
    evidenceSummary: trend.evidenceSummary ?? undefined,
    keywords: [],
  };
  const repair = await repairSectionsWithClaims({ markdown: blog.content, issues, unmarkedClaims: [], context });
  if (!repair) return null;

  // Verify the splice before persisting - a repair that didn't actually
  // fix the claims must not burn a QA round-trip to find out.
  const selfCheck = await selfCheckClaims(repair.markdown, groundedSources, trend.evidenceSummary, trend.id);

  // Repaired sections carry fresh [S]-markers; untouched sections already
  // hold real links (materialize only touches marker tokens - idempotent).
  const materialized = groundedSources.length > 0 ? materializeCitations(repair.markdown, groundedSources) : null;
  const markdown = materialized?.markdown ?? repair.markdown;

  let usageRecordId: string | null = null;
  const latencyShare = Math.round((Date.now() - startedAt) / Math.max(1, repair.usageRecords.length));
  for (const record of repair.usageRecords) {
    const saved = await recordAIUsage({ worker: "writing-worker", model: record.model, usage: record.usage, latencyMs: latencyShare, trendId: trend.id });
    if (!usageRecordId) usageRecordId = saved.id;
  }

  // Legacy URL citation check (not the marker check): the spliced article
  // carries already-materialized links, same as attemptTargetedRepair.
  const gate = writingGate(markdown, trend.evidenceSummary, undefined, { selfCheck, unmarkedClaims: [] });
  assertGate(gate);

  const html = await marked.parse(markdown);
  await prisma.blog.update({
    where: { id: blog.id },
    data: { content: markdown, html, status: "DRAFT" },
  });
  if (usageRecordId) await attachUsageToBlog(usageRecordId, blog.id);

  // Image worker's featuredImageId skip makes this a pass-through to QA.
  // Epoch-keyed jobId: each repair run gets a fresh ID so the QA re-score is
  // never deduped away against the original image job (see JOB_IDS docs).
  await imageQueue.add(
    "generate_blog_image",
    {
      blogId: blog.id,
      trendId: trend.id,
      title: blog.title,
      slug: blog.slug,
      category: "",
      excerpt: blog.excerpt ?? undefined,
    },
    { jobId: JOB_IDS.image(blog.id, attempt.attempt.id) }
  );
  await passWorkerAttempt({
    workflowRunId: attempt.workflow.id,
    attemptId: attempt.attempt.id,
    output: {
      blogId: blog.id,
      slug: blog.slug,
      score: gate.score,
      repairMode: "claim-targeted",
      repairedSections: repair.repairedSections,
      selfCheck: selfCheck ? { score: selfCheck.score, totalClaims: selfCheck.totalClaims, issues: selfCheck.issues.length } : undefined,
    },
    qualityReport: gate,
    nextStage: "image-worker",
    blogId: blog.id,
  });

  log.info(`Blog repaired via claim-targeted splice: ${blog.slug}`, {
    blogId: blog.id,
    sections: repair.repairedSections,
    selfCheckScore: selfCheck?.score,
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
  // Task 6.1 (consumer side): QA's concrete failing claims join the rewrite
  // prompt's priorAttempt reasons, so even a FULL rewrite knows exactly
  // which claims to drop or qualify instead of hallucinating fresh ones.
  const priorFactCheckIssues = recoveryContext?.factCheckIssues ?? [];
  const priorAttempt =
    priorReport || priorFactCheckIssues.length > 0
      ? {
          score: priorReport?.score ?? 0,
          reasons: [
            ...(priorReport?.reasons ?? []),
            ...priorFactCheckIssues.map(
              (issue) => `${issue.verdict} claim from fact-check: "${issue.claim}"${issue.note ? ` - ${issue.note}` : ""}`
            ),
          ],
        }
      : undefined;

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

    // Task 6: QA requeued this blog with concrete unverified claims -
    // splice-fix just the affected sections. Runs even when
    // TARGETED_REPAIR_ENABLED is off: that flag governs judge-fix repair,
    // this path is gated by WRITING_SELFCHECK_ENABLED since it depends on
    // the self-check module for post-repair verification.
    if (env.WRITING_SELFCHECK_ENABLED && priorFactCheckIssues.length > 0) {
      const repaired = await attemptClaimRepair({
        trend,
        topic,
        description,
        outline,
        groundedSources,
        factCheckIssues: priorFactCheckIssues,
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
      priorAttempt,
      trendId,
    });
    const latencyMs = Date.now() - startedAt;

    // Task 6.3/6.4/6.5: write-time claim self-check + claim-aware repair.
    // Runs on the RAW draft (markers intact) so marker enforcement can see
    // [S]-tokens; materializeCitations below then runs once, on the final
    // text. A draft that would be "Blocked - unverified facts" at QA is
    // repaired here - or, if repair can't fix it, fails the writing gate
    // with the concrete claim list instead of burning a QA round-trip.
    let selfCheck: SelfCheckResult | null = null;
    let unmarkedClaims: string[] = [];
    const repairUsageRecords: { model: string; usage: { promptTokens: number; completionTokens: number } }[] = [];
    let repairedSections: string[] = [];
    if (env.WRITING_SELFCHECK_ENABLED) {
      const repairStartedAt = Date.now();
      const markerEnforcementOn = env.WRITING_CLAIM_MARKER_ENFORCEMENT && groundedSources.length > 0;
      if (markerEnforcementOn) unmarkedClaims = findUnmarkedClaims(draft.markdown);
      selfCheck = await selfCheckClaims(draft.markdown, groundedSources, trend.evidenceSummary, trendId);

      const sectionContext: SectionArticleContext = {
        title: draft.title,
        topic,
        description,
        plan: outline?.plan,
        sources: groundedSources,
        evidenceSummary: trend.evidenceSummary ?? undefined,
        keywords: draft.keywords,
      };

      // Bounded section-repair loop: regenerate only the sections holding
      // failing/unmarked claims, then re-verify. A null repair means the
      // problem isn't section-local - the redraft below handles it.
      for (let pass = 0; pass < env.WRITING_SELFCHECK_MAX_REPAIR_PASSES; pass += 1) {
        const failing = selfCheck && selfCheck.score < SELFCHECK_PASS_SCORE ? selfCheck.issues : [];
        if (failing.length === 0 && unmarkedClaims.length === 0) break;
        const repair = await repairSectionsWithClaims({
          markdown: draft.markdown,
          issues: failing,
          unmarkedClaims,
          context: sectionContext,
        });
        if (!repair) break;
        repairUsageRecords.push(...repair.usageRecords);
        repairedSections = repair.repairedSections;
        draft.markdown = repair.markdown;
        if (markerEnforcementOn) unmarkedClaims = findUnmarkedClaims(draft.markdown);
        else unmarkedClaims = [];
        selfCheck = await selfCheckClaims(draft.markdown, groundedSources, trend.evidenceSummary, trendId);
      }

      // Last resort: one qualitative redraft carrying the concrete failing
      // claims as priorAttempt reasons (the rewrite prompt already knows
      // how to consume those - see buildPrompt's REWRITE block).
      if (selfCheck && selfCheck.score < SELFCHECK_PASS_SCORE) {
        log.warn("Claim repair insufficient, attempting one qualitative redraft", {
          trendId,
          selfCheckScore: selfCheck.score,
          issues: selfCheck.issues.length,
        });
        const redraft = await generateBlogDraft(topic, description, {
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
          priorAttempt: {
            score: selfCheck.score,
            reasons: selfCheck.issues
              .slice(0, 10)
              .map((issue) => `${issue.verdict} claim: "${issue.claim}"${issue.note ? ` - ${issue.note}` : ""}`),
          },
          trendId,
        });
        if (redraft.usageRecords && redraft.usageRecords.length > 0) {
          repairUsageRecords.push(...redraft.usageRecords);
        } else {
          repairUsageRecords.push({ model: redraft.model, usage: redraft.usage });
        }
        draft.markdown = redraft.markdown;
        if (markerEnforcementOn) unmarkedClaims = findUnmarkedClaims(draft.markdown);
        selfCheck = await selfCheckClaims(draft.markdown, groundedSources, trend.evidenceSummary, trendId);
      }

      // Repair/redraft spend is real spend - record it with wall-clock
      // latency split evenly, the same convention as sectioned drafts.
      const repairLatencyShare = Math.round((Date.now() - repairStartedAt) / Math.max(1, repairUsageRecords.length));
      for (const record of repairUsageRecords) {
        await recordAIUsage({ worker: "writing-worker", model: record.model, usage: record.usage, latencyMs: repairLatencyShare, trendId });
      }
    }

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
        : undefined,
      env.WRITING_SELFCHECK_ENABLED ? { selfCheck, unmarkedClaims } : undefined
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
    // Epoch-keyed jobId: a QA-requeued full rewrite re-runs this path with an
    // existing image job - the fresh ID keeps the chain moving (no stall).
    await imageQueue.add(
      "generate_blog_image",
      {
        blogId: blog.id,
        trendId,
        title: blog.title,
        slug: blog.slug,
        category: category.name,
        excerpt: draft.excerpt,
      },
      { jobId: JOB_IDS.image(blog.id, attempt.attempt.id) }
    );
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output: {
        blogId: blog.id,
        slug: blog.slug,
        score,
        grounded: groundedSources.length > 0,
        citations: citationMeta ?? undefined,
        selfCheck: selfCheck
          ? { score: selfCheck.score, totalClaims: selfCheck.totalClaims, issues: selfCheck.issues.length }
          : undefined,
        claimRepairedSections: repairedSections.length > 0 ? repairedSections : undefined,
      },
      qualityReport: gate,
      nextStage: "image-worker",
      blogId: blog.id,
    });

    log.info(`Blog created: ${blog.slug}`, {
      blogId: blog.id,
      score,
      grounded: groundedSources.length > 0,
      selfCheckScore: selfCheck?.score,
      claimRepairedSections: repairedSections.length > 0 ? repairedSections : undefined,
    });
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
    async (job) => withVertexTelemetryContext(
      { jobId: String(job.id), queue: QUEUE_NAMES.writing, worker: "writing-worker", pipeline: "content", stage: "writing" },
      () => withPipelineRetryPolicy(async () => {
      const { trendId, topic, description, outlineId, recoveryContext } = job.data as WritingJobPayload;
      return generateBlogForTrend(trendId, topic, description, outlineId, recoveryContext);
      })
    ),
    workerOptions(1)
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  logVertexRuntimeConfig(log);
  log.info(`Writing worker listening on "${QUEUE_NAMES.writing}"`);
  return worker;
}

if (require.main === module) {
  startWritingWorker();
}
