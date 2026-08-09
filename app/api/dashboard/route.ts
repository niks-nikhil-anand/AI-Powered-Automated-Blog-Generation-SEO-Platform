
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  imageQueue,
  outlineQueue,
  planningQueue,
  publishQueue,
  qualityQueue,
  researchQueue,
  writingQueue,
} from "@/workers/shared/queues";
import { queueCounts } from "@/lib/queues";
import {
  trendSourceLabel,
  trendSourceInitial,
  trendSourceColor,
} from "@/lib/research-sources";
import { getDailyTargetStatus } from "@/workers/shared/daily-target";
import { env } from "@/workers/shared/env";

export const dynamic = "force-dynamic";

function currentHourInTimezone(timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" });
  return Number(formatter.format(new Date()));
}

/** Checkpoints at 10am/4pm/9pm expect roughly 1/3, 2/3, and all of the daily target published by then. */
function expectedByNow(target: number, hour: number): number {
  if (hour < 10) return 0;
  if (hour < 16) return Math.ceil(target / 3);
  if (hour < 21) return Math.ceil((target * 2) / 3);
  return target;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfDayOffset(daysAgo: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

function formatUsd(value: number) {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function compactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

const MODEL_COLORS: Record<string, string> = {
  "gemini-2.5-pro": "var(--indigo)",
  "gemini-2.5-flash": "var(--emerald)",
  "gemini-2.5-flash-lite": "var(--sky)",
  "gemini-2.0-flash": "var(--sky)",
  fallback: "var(--mut)",
};

function modelColor(model: string) {
  const key = Object.keys(MODEL_COLORS).find((candidate) => model.toLowerCase().startsWith(candidate));
  return key ? MODEL_COLORS[key] : "var(--amber)";
}

const WORKER_COLORS: Record<string, string> = {
  "research-worker": "var(--emerald)",
  "planning-worker": "var(--indigo)",
  "outline-worker": "var(--sky)",
  "writing-worker": "var(--amber)",
  "image-worker": "var(--rose)",
  "quality-worker": "var(--mut)",
  "publish-worker": "var(--emerald)",
};

function formatAgo(date: Date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function wordCount(markdown: string) {
  return markdown.split(/\s+/).filter(Boolean).length;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function asQualityChecks(value: unknown): {
  label: string;
  score: number;
  maxScore: number;
  notes: string[];
}[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as { label?: unknown; score?: unknown; maxScore?: unknown; notes?: unknown };
      return {
        label: String(row.label ?? ""),
        score: Number(row.score ?? 0),
        maxScore: Number(row.maxScore ?? 10) || 10,
        notes: asStringArray(row.notes),
      };
    })
    .filter((row) => row.label);
}

function outlineMarkdown(outline: {
  title: string;
  metaDescription: string;
  sections: unknown;
  faqs: unknown;
}) {
  const sections = Array.isArray(outline.sections) ? outline.sections : [];
  const faqs = Array.isArray(outline.faqs) ? outline.faqs : [];
  const sectionText = sections
    .map((section) => {
      const row = section as { heading?: unknown; intent?: unknown; bullets?: unknown };
      const bullets = asStringArray(row.bullets).map((bullet) => `- ${bullet}`).join("\n");
      return `## ${String(row.heading ?? "Section")}\n\n${String(row.intent ?? "")}${bullets ? `\n\n${bullets}` : ""}`;
    })
    .join("\n\n");
  const faqText = faqs.length
    ? `\n\n## FAQ\n\n${faqs
        .map((faq) => {
          const row = faq as { question?: unknown; answerIntent?: unknown };
          return `### ${String(row.question ?? "Question")}\n\n${String(row.answerIntent ?? "")}`;
        })
        .join("\n\n")}`
    : "";
  return `# ${outline.title}\n\n${outline.metaDescription}\n\n${sectionText}${faqText}`.trim();
}

function blogStatusLabel(status: string) {
  if (status === "PUBLISHED") return "Published";
  if (status === "FAILED") return "Failed QA";
  if (status === "PENDING_REVIEW") return "Review";
  if (status === "ARCHIVED") return "Archived";
  return "Draft";
}

function recommendation(score: number) {
  if (score >= 85) return "Highly Recommended";
  if (score >= 70) return "Recommended";
  if (score >= 50) return "Consider Topic";
  return "Low Priority";
}

function statusStyle(status: string) {
  if (status === "Published" || status === "PROCESSED") {
    return {
      sBg: "rgba(16,185,129,0.12)",
      sFg: "var(--emerald)",
      sBd: "rgba(16,185,129,0.3)",
    };
  }
  if (status === "Failed QA" || status === "FAILED" || status === "REJECTED") {
    return {
      sBg: "rgba(244,63,94,0.12)",
      sFg: "var(--rose)",
      sBd: "rgba(244,63,94,0.3)",
    };
  }
  return {
    sBg: "rgba(99,102,241,0.12)",
    sFg: "var(--indigo)",
    sBd: "rgba(99,102,241,0.3)",
  };
}

type QueueCountsResult = Awaited<ReturnType<typeof queueCounts>>;

function stageState(counts: QueueCountsResult, total: number) {
  if (counts.active > 0) return "running";
  if (counts.waiting > 0) return "queued";
  if (counts.delayed > 0) return "scheduled";
  if (counts.failed > 0) return "failed";
  if (total > 0) return "done";
  return "idle";
}

function queueColor(counts: QueueCountsResult, total: number, doneColor = "var(--emerald)") {
  if (counts.active > 0) return "var(--indigo)";
  if (counts.waiting > 0 || counts.delayed > 0) return "var(--amber)";
  if (counts.failed > 0) return "var(--rose)";
  if (total > 0) return doneColor;
  return "var(--mut)";
}

export async function GET() {
  try {
    const today = startOfToday();
  const [
    blogs,
    blogCount,
    publishedCount,
    failedCount,
    todayPublishedCount,
    trends,
    outlines,
    assets,
    aiUsage,
    plansCount,
    outlinesCount,
    jobs,
    researchCounts,
    planningCounts,
    outlineCounts,
    writingCounts,
    imageCounts,
    qualityCounts,
    publishCounts,
  ] = await Promise.all([
    prisma.blog.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { category: true, seo: true, featuredImage: true, qualityReport: true },
    }),
    prisma.blog.count(),
    prisma.blog.count({ where: { status: "PUBLISHED" } }),
    prisma.blog.count({ where: { status: "FAILED" } }),
    prisma.blog.count({ where: { status: "PUBLISHED", updatedAt: { gte: today } } }),
    prisma.trend.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.contentOutline.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { trend: true, plan: true },
    }),
    prisma.asset.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.aIUsage.findMany({
      where: { createdAt: { gte: startOfDayOffset(6) } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.contentPlan.count(),
    prisma.contentOutline.count(),
    prisma.job.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    queueCounts(researchQueue),
    queueCounts(planningQueue),
    queueCounts(outlineQueue),
    queueCounts(writingQueue),
    queueCounts(imageQueue),
    queueCounts(qualityQueue),
    queueCounts(publishQueue),
  ]);
  const workflowRuns = blogs.length
    ? await prisma.workflowRun.findMany({
        where: { OR: blogs.map((blog) => ({ blogId: blog.id })) },
        include: { attempts: { orderBy: { startedAt: "asc" } } },
        orderBy: { updatedAt: "desc" },
      })
    : [];
  const workflowsByBlogId = new Map(workflowRuns.filter((run) => run.blogId).map((run) => [run.blogId!, run]));

  // Settings page "Worker Activity" panel, for the six workers that have no
  // schedule (they run reactively - see workers/shared/settings.ts). Built
  // from the WorkerAttempt rows already fetched above rather than a new
  // query. Known gap: workflowRuns is scoped to the 50 latest *blogs*, so a
  // planning/outline attempt that failed before a Blog row ever existed
  // (no blogId got attached to that run) won't be counted here - this is a
  // "recent activity" view, not an exhaustive audit log.
  const REACTIVE_WORKERS = [
    "planning-worker",
    "outline-worker",
    "writing-worker",
    "image-worker",
    "quality-worker",
    "publish-worker",
  ] as const;
  const attemptsByWorker = new Map<string, { startedAt: Date; finishedAt: Date | null; status: string }[]>();
  for (const run of workflowRuns) {
    for (const attempt of run.attempts) {
      const list = attemptsByWorker.get(attempt.worker) ?? [];
      list.push({ startedAt: attempt.startedAt, finishedAt: attempt.finishedAt, status: attempt.status });
      attemptsByWorker.set(attempt.worker, list);
    }
  }
  const workerActivity = REACTIVE_WORKERS.map((worker) => {
    const attempts = (attemptsByWorker.get(worker) ?? []).sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    );
    const last = attempts[0];
    const durations = attempts
      .filter((a) => a.finishedAt)
      .map((a) => a.finishedAt!.getTime() - a.startedAt.getTime());
    const avgDurationMs = durations.length
      ? Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length)
      : null;
    return {
      worker,
      lastRanAt: last ? last.startedAt.toISOString() : null,
      lastStatus: last?.status ?? null,
      avgDurationMs,
      sampleCount: attempts.length,
    };
  });

  // Cost attributed to each blog (used by blog rows and the cost tables below).
  const usageByBlog = new Map<string, { cost: number; tokens: number; calls: number; models: Set<string> }>();
  for (const row of aiUsage) {
    if (!row.blogId) continue;
    const entry = usageByBlog.get(row.blogId) ?? { cost: 0, tokens: 0, calls: 0, models: new Set<string>() };
    entry.cost += row.cost;
    entry.tokens += row.promptTokens + row.completionTokens;
    entry.calls += 1;
    entry.models.add(row.model);
    usageByBlog.set(row.blogId, entry);
  }

  const blogRows = blogs.map((blog) => {
    const status = blogStatusLabel(blog.status);
    // blog.seo.score starts out as writing-worker's own rough placeholder
    // heuristic (see writing-worker/index.ts) before quality-worker ever
    // runs - falling back to it here made a not-yet-scored blog display an
    // unrelated number that could look like a passing quality score while
    // the real gate (qualityReport.passed) correctly still said "not
    // passed", which is exactly backwards. Only the real report counts.
    const quality = blog.qualityReport?.overallScore ?? null;
    const spend = usageByBlog.get(blog.id);
    return {
      id: blog.id,
      title: blog.title,
      slug: blog.slug,
      cat: blog.category?.name ?? "General",
      words: wordCount(blog.content).toLocaleString(),
      trend: "-",
      quality: quality !== null ? String(quality) : "Pending",
      cost: formatUsd(spend?.cost ?? 0),
      costValue: spend?.cost ?? 0,
      tokens: spend ? compactNumber(spend.tokens) : "-",
      tokenCount: spend?.tokens ?? 0,
      aiCalls: spend?.calls ?? 0,
      models: spend ? [...spend.models] : [],
      status,
      updated: formatAgo(blog.updatedAt),
      createdAt: blog.createdAt.toISOString(),
      updatedAt: blog.updatedAt.toISOString(),
      createdAtLabel: blog.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      updatedAtLabel: blog.updatedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      qBg: quality === null ? "var(--card2)" : quality >= 90 ? "rgba(16,185,129,0.14)" : quality > 0 ? "rgba(245,158,11,0.14)" : "var(--card2)",
      qFg: quality === null ? "var(--mut)" : quality >= 90 ? "var(--emerald)" : quality > 0 ? "var(--amber)" : "var(--fg2)",
      ...statusStyle(status),
      content: blog.content,
      metaTitle: blog.seo?.metaTitle,
      metaDescription: blog.seo?.metaDescription,
      keywords: Array.isArray(blog.seo?.keywords) ? blog.seo?.keywords : [],
      schema: blog.seo?.schema ? JSON.stringify(blog.seo.schema, null, 2) : undefined,
      qualityReport: blog.qualityReport
        ? {
            overallScore: blog.qualityReport.overallScore,
            passed: blog.qualityReport.passed,
            recommendation: blog.qualityReport.recommendation,
            checks: blog.qualityReport.checks,
            // Task 3/4 detail payloads - serialized through so
            // BlogDetailModal can render the claim-level fact check and the
            // editorial judge breakdown. Absent on legacy reports.
            factCheckDetail: blog.qualityReport.factCheckDetail,
            judgeDetail: blog.qualityReport.judgeDetail,
            createdAt: blog.qualityReport.createdAt.toISOString(),
          }
        : undefined,
      workflow: workflowsByBlogId.get(blog.id)
        ? {
            id: workflowsByBlogId.get(blog.id)!.id,
            status: workflowsByBlogId.get(blog.id)!.status,
            currentStage: workflowsByBlogId.get(blog.id)!.currentStage,
            failureReason: workflowsByBlogId.get(blog.id)!.failureReason,
            attempts: workflowsByBlogId.get(blog.id)!.attempts.map((attempt) => ({
              id: attempt.id,
              worker: attempt.worker,
              attempt: attempt.attempt,
              status: attempt.status,
              error: attempt.error,
              qualityReport: attempt.qualityReport,
              startedAt: attempt.startedAt.toISOString(),
              finishedAt: attempt.finishedAt?.toISOString(),
            })),
          }
        : undefined,
      featuredImage: blog.featuredImage
        ? {
            id: blog.featuredImage.id,
            name: blog.featuredImage.fileName,
            bucket: blog.featuredImage.bucket,
            path: blog.featuredImage.path,
            publicUrl: blog.featuredImage.publicUrl,
            mimeType: blog.featuredImage.mimeType,
            width: blog.featuredImage.width,
            height: blog.featuredImage.height,
            size: blog.featuredImage.size,
          }
        : undefined,
    };
  });

  const outlineRows = outlines.map((outline) => {
    const quality = Math.round(outline.trend.score);
    const markdown = outlineMarkdown(outline);
    const keywords = [
      outline.plan.primaryKeyword,
      ...asStringArray(outline.plan.secondaryKeywords),
    ].filter(Boolean);
    return {
      id: outline.id,
      title: outline.title,
      slug: outline.slug,
      cat: outline.trend.category,
      words: wordCount(markdown).toLocaleString(),
      trend: String(Math.round(outline.trend.score)),
      quality: String(quality),
      cost: "$0.00",
      status: "Review",
      updated: formatAgo(outline.updatedAt),
      createdAt: outline.createdAt.toISOString(),
      updatedAt: outline.updatedAt.toISOString(),
      createdAtLabel: outline.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      updatedAtLabel: outline.updatedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      qBg: quality >= 90 ? "rgba(16,185,129,0.14)" : quality > 0 ? "rgba(245,158,11,0.14)" : "var(--card2)",
      qFg: quality >= 90 ? "var(--emerald)" : quality > 0 ? "var(--amber)" : "var(--fg2)",
      ...statusStyle("Review"),
      content: markdown,
      metaTitle: outline.metaTitle,
      metaDescription: outline.metaDescription,
      keywords,
      schema: JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: outline.title,
          keywords: keywords.join(", "),
        },
        null,
        2
      ),
    };
  });

  const trendRows = trends.map((trend) => {
    const score = Math.round(trend.score);
    const rec = recommendation(score);
    return {
      id: trend.id,
      srcInitial: trendSourceInitial(trend.source),
      source: trendSourceLabel(trend.source),
      srcColor: trendSourceColor(trend.source),
      score: String(score),
      scoreBg: score >= 70 ? "rgba(16,185,129,0.14)" : "var(--card2)",
      scoreFg: score >= 70 ? "var(--emerald)" : "var(--fg2)",
      title: trend.topic,
      cat: trend.category,
      rec,
      recBg: score >= 70 ? "rgba(16,185,129,0.12)" : "var(--card2)",
      recFg: score >= 70 ? "var(--emerald)" : "var(--fg2)",
      volume: `${trend.status} · ${formatAgo(trend.createdAt)}`,
      scorePct: `${Math.min(100, Math.max(0, score))}%`,
      // Detail-modal payloads (TrendDetailModal): raw status + timestamps for
      // the overview grid, evidenceSummary for the research summary/evidence
      // fallback, scoreBreakdown for the signal bars, and evidenceArticles
      // (Task 1) for the rich [S1]-style source cards. All optional/nullable -
      // legacy rows just render fewer sections.
      status: trend.status,
      createdAt: trend.createdAt.toISOString(),
      evidenceSummary: trend.evidenceSummary ?? null,
      scoreBreakdown: trend.scoreBreakdown ?? null,
      evidenceArticles: Array.isArray(trend.evidenceArticles) ? trend.evidenceArticles : null,
    };
  });

  const assetRows = assets.map((asset) => ({
    id: asset.id,
    name: asset.fileName,
    placeholder: asset.mimeType,
    kind: asset.mimeType.includes("image") ? "Hero" : "Asset",
    dim: asset.width && asset.height ? `${asset.width}x${asset.height}` : "-",
    size: `${Math.round(asset.size / 1024)} KB`,
    sizeBytes: asset.size,
    path: asset.path,
    bucket: asset.bucket,
    publicUrl: asset.publicUrl,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt.toISOString(),
    month: `${asset.createdAt.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
    })} / ${asset.createdAt.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      month: "2-digit",
    })}`,
    kindBg: "rgba(99,102,241,0.14)",
    kindFg: "var(--indigo)",
  }));

  // ---------------------------------------------------------------------
  // AI cost / token analytics (real data from the AIUsage table)
  // ---------------------------------------------------------------------
  const yesterday = startOfDayOffset(1);
  const usageToday = aiUsage.filter((row) => row.createdAt >= today);
  const usageYesterday = aiUsage.filter((row) => row.createdAt >= yesterday && row.createdAt < today);

  const sumCost = (rows: typeof aiUsage) => rows.reduce((sum, row) => sum + row.cost, 0);
  const sumPrompt = (rows: typeof aiUsage) => rows.reduce((sum, row) => sum + row.promptTokens, 0);
  const sumCompletion = (rows: typeof aiUsage) => rows.reduce((sum, row) => sum + row.completionTokens, 0);

  const totalCost = sumCost(usageToday);
  const costYesterday = sumCost(usageYesterday);
  const weekCost = sumCost(aiUsage);
  const promptTokensToday = sumPrompt(usageToday);
  const completionTokensToday = sumCompletion(usageToday);
  const totalTokensToday = promptTokensToday + completionTokensToday;
  const costDeltaPct =
    costYesterday > 0 ? Math.round(((totalCost - costYesterday) / costYesterday) * 100) : null;

  const avgLatencyToday = usageToday.length
    ? Math.round(usageToday.reduce((sum, row) => sum + row.latency, 0) / usageToday.length)
    : 0;

  // Per-model rollup (today)
  const modelMap = new Map<
    string,
    { model: string; cost: number; calls: number; promptTokens: number; completionTokens: number; latency: number }
  >();
  for (const row of usageToday) {
    const entry = modelMap.get(row.model) ?? {
      model: row.model,
      cost: 0,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      latency: 0,
    };
    entry.cost += row.cost;
    entry.calls += 1;
    entry.promptTokens += row.promptTokens;
    entry.completionTokens += row.completionTokens;
    entry.latency += row.latency;
    modelMap.set(row.model, entry);
  }
  const modelBreakdown = [...modelMap.values()]
    .sort((a, b) => b.cost - a.cost)
    .map((entry) => ({
      model: entry.model,
      cost: entry.cost,
      costLabel: formatUsd(entry.cost),
      calls: entry.calls,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      totalTokens: entry.promptTokens + entry.completionTokens,
      totalTokensLabel: compactNumber(entry.promptTokens + entry.completionTokens),
      avgLatencyMs: entry.calls ? Math.round(entry.latency / entry.calls) : 0,
      sharePct: totalCost > 0 ? Math.round((entry.cost / totalCost) * 100) : 0,
      color: modelColor(entry.model),
    }));

  // Per-worker rollup (today)
  const workerMap = new Map<
    string,
    { worker: string; cost: number; calls: number; promptTokens: number; completionTokens: number; latency: number }
  >();
  for (const row of usageToday) {
    const entry = workerMap.get(row.worker) ?? {
      worker: row.worker,
      cost: 0,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      latency: 0,
    };
    entry.cost += row.cost;
    entry.calls += 1;
    entry.promptTokens += row.promptTokens;
    entry.completionTokens += row.completionTokens;
    entry.latency += row.latency;
    workerMap.set(row.worker, entry);
  }
  const workerBreakdown = [...workerMap.values()]
    .sort((a, b) => b.cost - a.cost)
    .map((entry) => ({
      worker: entry.worker,
      label: entry.worker.replace(/-worker$/, "").replace(/^\w/, (c) => c.toUpperCase()),
      cost: entry.cost,
      costLabel: formatUsd(entry.cost),
      calls: entry.calls,
      totalTokens: entry.promptTokens + entry.completionTokens,
      totalTokensLabel: compactNumber(entry.promptTokens + entry.completionTokens),
      avgLatencyMs: entry.calls ? Math.round(entry.latency / entry.calls) : 0,
      sharePct: totalCost > 0 ? Math.round((entry.cost / totalCost) * 100) : 0,
      color: WORKER_COLORS[entry.worker] ?? "var(--mut)",
    }));

  // 7-day daily series, oldest -> newest
  const dailySeries = Array.from({ length: 7 }, (_, index) => {
    const dayStart = startOfDayOffset(6 - index);
    const dayEnd = startOfDayOffset(5 - index);
    const rows = aiUsage.filter((row) => row.createdAt >= dayStart && row.createdAt < dayEnd);
    const byModel = new Map<string, number>();
    for (const row of rows) {
      byModel.set(row.model, (byModel.get(row.model) ?? 0) + row.cost);
    }
    return {
      day: dayStart.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }),
      date: dayStart.toISOString().slice(0, 10),
      cost: sumCost(rows),
      promptTokens: sumPrompt(rows),
      completionTokens: sumCompletion(rows),
      calls: rows.length,
      models: [...byModel.entries()].map(([model, cost]) => ({ model, cost, color: modelColor(model) })),
    };
  });
  const maxDailyCost = Math.max(...dailySeries.map((day) => day.cost), 0);

  const blogsWithCost = blogs.filter((blog) => usageByBlog.has(blog.id));
  const avgCostPerBlog = blogsWithCost.length
    ? blogsWithCost.reduce((sum, blog) => sum + (usageByBlog.get(blog.id)?.cost ?? 0), 0) / blogsWithCost.length
    : 0;
  const qualityReportCount = blogs.filter((blog) => blog.qualityReport).length;
  const qualityScores = blogs
    .map((blog) => blog.qualityReport?.overallScore ?? null)
    .filter((score): score is number => score !== null);
  const avgQuality =
    qualityScores.length > 0
      ? Math.round(qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length)
      : 0;
  const successRate = blogCount > 0 ? Math.round((publishedCount / blogCount) * 100) : 0;
  const qualityBuckets = [
    { label: "< 80", min: 0, max: 79, fill: "var(--rose)" },
    { label: "80-84", min: 80, max: 84, fill: "var(--rose)" },
    { label: "85-89", min: 85, max: 89, fill: "var(--amber)" },
    { label: "90-91", min: 90, max: 91, fill: "var(--emerald)" },
    { label: "92-93", min: 92, max: 93, fill: "var(--emerald)" },
    { label: "94-95", min: 94, max: 95, fill: "var(--emerald)" },
    { label: "96-97", min: 96, max: 97, fill: "var(--emerald)" },
    { label: "98-100", min: 98, max: 100, fill: "var(--emerald)" },
  ].map((bucket) => {
    const count = qualityScores.filter((score) => score >= bucket.min && score <= bucket.max).length;
    const maxCount = Math.max(1, qualityScores.length);
    return {
      label: bucket.label,
      count,
      h: count > 0 ? Math.max(8, Math.round((count / maxCount) * 130)) : 0,
      fill: bucket.fill,
    };
  });
  const qualityParameters = [
    "SEO Structure",
    "Content Completeness",
    "Readability",
    "Content Quality",
    "Keyword Optimization",
    "Technical SEO",
    "Formatting & UX",
    "Media Quality",
    "AI & Fact Quality",
    "Publishing Readiness",
  ].map((label) => {
    const checks = blogs.flatMap((blog) =>
      asQualityChecks(blog.qualityReport?.checks).filter((check) => check.label === label)
    );
    const avg =
      checks.length > 0
        ? Math.round((checks.reduce((sum, check) => sum + check.score / check.maxScore, 0) / checks.length) * 100)
        : 0;
    return {
      name: label,
      value: `${avg}%`,
      color: avg >= 90 ? "var(--emerald)" : avg >= 70 ? "var(--amber)" : avg > 0 ? "var(--rose)" : "var(--mut)",
    };
  });
  // Split "not passing" into the two states the quality page needs to tell
  // apart: still auto-retrying via writing-worker (attempts 1-3 of 4) vs.
  // permanently failed (4/4 attempts used, needs a manual decision).
  const regeneratingRows = blogRows.filter(
    (blog) => blog.status === "Review" && Number(blog.quality) > 0 && Number(blog.quality) < 90
  );
  const permanentlyFailedRows = blogRows.filter((blog) => blog.status === "Failed QA");
  const passedRowsWithWorkflow = blogRows.filter((blog) => blog.qualityReport?.passed && blog.workflow);
  const attemptsToPassSamples = passedRowsWithWorkflow.map(
    (blog) => 1 + (blog.workflow?.attempts.filter((attempt) => attempt.worker === "writing-worker").length ?? 0)
  );
  const avgAttemptsToPass =
    attemptsToPassSamples.length > 0
      ? Math.round((attemptsToPassSamples.reduce((sum, n) => sum + n, 0) / attemptsToPassSamples.length) * 10) / 10
      : 1;

  const stageTotals = {
    research: trends.length,
    planning: plansCount,
    outline: outlinesCount,
    writing: blogs.filter((blog) => blog.status === "DRAFT").length,
    image: assets.length,
    quality: qualityReportCount,
    publish: publishedCount,
  };
  const queueSnapshots = [
    { key: "research", name: "research_queue", counts: researchCounts, total: stageTotals.research, doneColor: "var(--emerald)" },
    { key: "planning", name: "planning_queue", counts: planningCounts, total: stageTotals.planning, doneColor: "var(--indigo)" },
    { key: "outline", name: "outline_queue", counts: outlineCounts, total: stageTotals.outline, doneColor: "var(--indigo)" },
    { key: "writing", name: "writing_queue", counts: writingCounts, total: blogCount, doneColor: "var(--indigo)" },
    { key: "image", name: "image_queue", counts: imageCounts, total: stageTotals.image, doneColor: "var(--sky)" },
    { key: "quality", name: "quality_queue", counts: qualityCounts, total: stageTotals.quality, doneColor: "var(--amber)" },
    { key: "publish", name: "publish_queue", counts: publishCounts, total: stageTotals.publish, doneColor: "var(--emerald)" },
  ] as const;
  const pipeline = queueSnapshots.reduce(
    (acc, item) => {
      acc.active += item.counts.active;
      acc.waiting += item.counts.waiting;
      acc.delayed += item.counts.delayed;
      acc.failed += item.counts.failed;
      acc.completed += item.counts.completed;
      return acc;
    },
    { active: 0, waiting: 0, delayed: 0, failed: 0, completed: 0 }
  );

  const dailyTargetStatus = await getDailyTargetStatus();
  const expectedPublishedByNow = expectedByNow(dailyTargetStatus.target, currentHourInTimezone(env.TIMEZONE));
  const behindPace = dailyTargetStatus.publishedToday < expectedPublishedByNow;

  return NextResponse.json({
    metrics: {
      blogCount,
      publishedCount,
      failedCount,
      todayPublishedCount,
      successRate,
      totalCost,
      avgQuality,
      costYesterday,
      costDeltaPct,
      weekCost,
      avgCostPerBlog,
      promptTokensToday,
      completionTokensToday,
      totalTokensToday,
      aiCallsToday: usageToday.length,
      avgLatencyToday,
      dailyTarget: dailyTargetStatus.target,
      dailyTargetRemaining: dailyTargetStatus.remaining,
      dailyTargetInFlight: dailyTargetStatus.inFlight,
      dailyTargetBacklogAvailable: dailyTargetStatus.backlogAvailable,
      behindPace,
      expectedPublishedByNow,
    },
    analytics: {
      cost: {
        today: totalCost,
        todayLabel: formatUsd(totalCost),
        yesterday: costYesterday,
        yesterdayLabel: formatUsd(costYesterday),
        deltaPct: costDeltaPct,
        week: weekCost,
        weekLabel: formatUsd(weekCost),
        perBlog: avgCostPerBlog,
        perBlogLabel: formatUsd(avgCostPerBlog),
        projectedMonth: totalCost * 30,
        projectedMonthLabel: formatUsd(totalCost * 30),
      },
      tokens: {
        prompt: promptTokensToday,
        promptLabel: compactNumber(promptTokensToday),
        completion: completionTokensToday,
        completionLabel: compactNumber(completionTokensToday),
        total: totalTokensToday,
        totalLabel: compactNumber(totalTokensToday),
        ratio: completionTokensToday > 0 ? Number((promptTokensToday / completionTokensToday).toFixed(2)) : 0,
        perBlog: blogsWithCost.length
          ? Math.round(
              blogsWithCost.reduce((sum, blog) => sum + (usageByBlog.get(blog.id)?.tokens ?? 0), 0) /
                blogsWithCost.length
            )
          : 0,
      },
      models: modelBreakdown,
      workers: workerBreakdown,
      daily: dailySeries.map((day) => ({
        ...day,
        costLabel: formatUsd(day.cost),
        heightPct: maxDailyCost > 0 ? Math.max(2, Math.round((day.cost / maxDailyCost) * 100)) : 0,
      })),
      maxDailyCost,
      calls: usageToday.length,
      avgLatencyMs: avgLatencyToday,
    },
    stages: stageTotals,
    stageStatus: Object.fromEntries(
      queueSnapshots.map((item) => [
        item.key,
        {
          total: item.total,
          active: item.counts.active,
          waiting: item.counts.waiting,
          delayed: item.counts.delayed,
          failed: item.counts.failed,
          completed: item.counts.completed,
          state: stageState(item.counts, item.total),
          dot: queueColor(item.counts, item.total, item.doneColor),
          anim: item.counts.active > 0 ? "animate-dkpulse" : "none",
        },
      ])
    ),
    pipeline: {
      ...pipeline,
      running: pipeline.active > 0,
      hasBacklog: pipeline.waiting + pipeline.delayed > 0,
      state:
        pipeline.active > 0
            ? "running"
            : pipeline.waiting + pipeline.delayed > 0
              ? "queued"
              : pipeline.failed > 0
                ? "failed"
                : "idle",
    },
    blogs: [...outlineRows, ...blogRows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    blogRows,
    outlineRows,
    trends: trendRows,
    assets: assetRows,
    usage: aiUsage.slice(0, 100).map((row) => ({
      id: row.id,
      worker: row.worker,
      model: row.model,
      blogId: row.blogId,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.promptTokens + row.completionTokens,
      cost: row.cost,
      costLabel: formatUsd(row.cost),
      latency: row.latency,
      color: modelColor(row.model),
      createdAt: row.createdAt,
    })),
    workerActivity,
    queues: queueSnapshots.map((queue) => ({
      name: queue.name,
      waiting: String(queue.counts.waiting + queue.counts.delayed),
      active: String(queue.counts.active),
      completed: String(queue.counts.completed),
      failed: String(queue.counts.failed),
      dot: queueColor(queue.counts, queue.total, queue.doneColor),
      anim: queue.counts.active > 0 ? "animate-dkpulse" : "none",
      rate: "db",
      p95: "-",
      failedColor: queue.counts.failed > 0 ? "var(--rose)" : "var(--mut)",
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      queue: job.queue,
      payload: JSON.stringify(job.payload),
      attempts: job.attempts,
      duration: "-",
      state: job.status,
      ...statusStyle(job.status),
      errBtn: job.error ? "inline-block" : "none",
      stack: job.error ?? undefined,
    })),
    workflows: workflowRuns.map((run) => ({
      id: run.id,
      blogId: run.blogId,
      trendId: run.trendId,
      status: run.status,
      currentStage: run.currentStage,
      failureReason: run.failureReason,
      attempts: run.attempts.length,
      updatedAt: run.updatedAt.toISOString(),
    })),
    logs: [
      ...trends.slice(0, 8).map((trend) => ({
        time: trend.createdAt.toISOString().slice(11, 19),
        level: "INFO",
        worker: "research_worker",
        msg: `Research candidate ${trend.status}: ${trend.topic}`,
        color: "var(--emerald)",
      })),
      ...aiUsage.slice(0, 8).map((usage) => ({
        time: usage.createdAt.toISOString().slice(11, 19),
        level: "INFO",
        worker: usage.worker,
        msg: `${usage.model} · ${usage.promptTokens} in / ${usage.completionTokens} out · ${formatUsd(usage.cost)} · ${usage.latency}ms`,
        color: "var(--indigo)",
      })),
    ].sort((a, b) => b.time.localeCompare(a.time)),
    quality: {
      avgQuality,
      failedCount,
      checkedCount: qualityReportCount,
      blocked: permanentlyFailedRows,
      regenerating: regeneratingRows,
      reports: blogRows.filter((blog) => blog.qualityReport),
      distribution: qualityBuckets,
      checkRates: qualityParameters,
      avgAttemptsToPass,
      retryLimit: 4,
      flow: {
        writing: {
          active: writingCounts.active,
          queued: writingCounts.waiting + writingCounts.delayed,
          failed: writingCounts.failed,
        },
        quality: {
          active: qualityCounts.active,
          queued: qualityCounts.waiting + qualityCounts.delayed,
          failed: qualityCounts.failed,
        },
        publish: {
          active: publishCounts.active,
          queued: publishCounts.waiting + publishCounts.delayed,
          failed: publishCounts.failed,
          published: publishedCount,
        },
        regenerating: regeneratingRows.length,
        failed: permanentlyFailedRows.length,
      },
    },
  });
} catch (error) {
  console.error("Failed to fetch dashboard data:", error);
  return NextResponse.json(
    { ok: false, error: "Failed to fetch dashboard data" },
    { status: 500 }
  );
}
}
