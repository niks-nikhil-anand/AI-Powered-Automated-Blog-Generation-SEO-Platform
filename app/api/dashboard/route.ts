import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

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

function trendSourceLabel(source: string) {
  if (source.includes("google_trends")) return "Google Trends";
  if (source.includes("google_news")) return "Google News";
  if (source.includes("github_trending")) return "GitHub Trending";
  return source;
}

function sourceInitial(source: string) {
  if (source.includes("google_trends")) return "GT";
  if (source.includes("google_news")) return "GN";
  if (source.includes("github_trending")) return "GH";
  return source.slice(0, 2).toUpperCase();
}

function sourceColor(source: string) {
  if (source.includes("google_trends")) return "var(--indigo)";
  if (source.includes("google_news")) return "var(--emerald)";
  if (source.includes("github_trending")) return "#171717";
  return "var(--mut)";
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

export async function GET() {
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
  ] = await Promise.all([
    prisma.blog.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { category: true, seo: true, featuredImage: true },
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
    prisma.aIUsage.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.contentPlan.count(),
    prisma.contentOutline.count(),
    prisma.job.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
  ]);

  const blogRows = blogs.map((blog) => {
    const status = blogStatusLabel(blog.status);
    const quality = blog.seo?.score ?? 0;
    return {
      id: blog.id,
      title: blog.title,
      slug: blog.slug,
      cat: blog.category?.name ?? "General",
      words: wordCount(blog.content).toLocaleString(),
      trend: "-",
      quality: String(quality),
      cost: "$0.00",
      status,
      updated: formatAgo(blog.updatedAt),
      createdAt: blog.createdAt.toISOString(),
      updatedAt: blog.updatedAt.toISOString(),
      createdAtLabel: blog.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      updatedAtLabel: blog.updatedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      qBg: quality >= 90 ? "rgba(16,185,129,0.14)" : quality > 0 ? "rgba(245,158,11,0.14)" : "var(--card2)",
      qFg: quality >= 90 ? "var(--emerald)" : quality > 0 ? "var(--amber)" : "var(--fg2)",
      ...statusStyle(status),
      content: blog.content,
      metaTitle: blog.seo?.metaTitle,
      metaDescription: blog.seo?.metaDescription,
      keywords: Array.isArray(blog.seo?.keywords) ? blog.seo?.keywords : [],
      schema: blog.seo?.schema ? JSON.stringify(blog.seo.schema, null, 2) : undefined,
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
      srcInitial: sourceInitial(trend.source),
      source: trendSourceLabel(trend.source),
      srcColor: sourceColor(trend.source),
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
    };
  });

  const assetRows = assets.map((asset) => ({
    id: asset.id,
    name: asset.fileName,
    placeholder: asset.mimeType,
    kind: asset.width && asset.height ? `${asset.width}x${asset.height}` : "Asset",
    dim: asset.width && asset.height ? `${asset.width}x${asset.height}` : "-",
    size: `${Math.round(asset.size / 1024)} KB`,
    path: asset.path,
    kindBg: "rgba(99,102,241,0.14)",
    kindFg: "var(--indigo)",
  }));

  const totalCost = aiUsage.reduce((sum, row) => sum + row.cost, 0);
  const avgQuality =
    blogs.length > 0
      ? Math.round(blogs.reduce((sum, blog) => sum + (blog.seo?.score ?? 0), 0) / blogs.length)
      : 0;
  const successRate = blogCount > 0 ? Math.round((publishedCount / blogCount) * 100) : 0;

  return NextResponse.json({
    metrics: {
      blogCount,
      publishedCount,
      failedCount,
      todayPublishedCount,
      successRate,
      totalCost,
      avgQuality,
    },
    stages: {
      research: trends.length,
      planning: plansCount,
      outline: outlinesCount,
      writing: blogs.filter((blog) => blog.status === "DRAFT").length,
      image: assets.length,
      quality: blogs.filter((blog) => (blog.seo?.score ?? 0) > 0).length,
      publish: publishedCount,
    },
    blogs: [...outlineRows, ...blogRows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    trends: trendRows,
    assets: assetRows,
    usage: aiUsage.map((row) => ({
      id: row.id,
      worker: row.worker,
      model: row.model,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      cost: row.cost,
      createdAt: row.createdAt,
    })),
    queues: [
      { name: "research_queue", completed: trends.length, active: 0, waiting: trends.filter((row) => row.status === "NEW").length, failed: 0 },
      { name: "planning_queue", completed: plansCount, active: 0, waiting: trends.filter((row) => row.status === "PLANNED").length, failed: 0 },
      { name: "outline_queue", completed: outlinesCount, active: 0, waiting: Math.max(0, plansCount - outlinesCount), failed: 0 },
      { name: "writing_queue", completed: blogCount, active: 0, waiting: Math.max(0, outlinesCount - blogCount), failed: failedCount },
      { name: "image_queue", completed: assets.length, active: 0, waiting: Math.max(0, blogCount - assets.length), failed: 0 },
    ].map((queue) => ({
      ...queue,
      waiting: String(queue.waiting),
      active: String(queue.active),
      completed: String(queue.completed),
      failed: String(queue.failed),
      dot: Number(queue.active) > 0 ? "var(--indigo)" : Number(queue.completed) > 0 ? "var(--emerald)" : "var(--mut)",
      anim: Number(queue.active) > 0 ? "animate-dkpulse" : "none",
      rate: "db",
      p95: "-",
      failedColor: Number(queue.failed) > 0 ? "var(--rose)" : "var(--mut)",
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
        msg: `${usage.model} usage: ${usage.promptTokens} prompt tokens, ${usage.completionTokens} completion tokens`,
        color: "var(--indigo)",
      })),
    ].sort((a, b) => b.time.localeCompare(a.time)),
    quality: {
      avgQuality,
      failedCount,
      checkedCount: blogs.filter((blog) => blog.seo).length,
      blocked: blogRows.filter((blog) => Number(blog.quality) > 0 && Number(blog.quality) < 90),
    },
  });
}
