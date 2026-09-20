import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { blogInputSchema, slugifyTitle } from "@/app/dashboard/blogs/new/types";
import { dispatchBlogInput } from "@/workers/shared/daily-target";

export const dynamic = "force-dynamic";

const VALID_SORTS = new Set(["createdAt", "title", "category", "status", "priority"]);

function stageForInput(input: {
  status: string;
  plan: { id: string } | null;
  outline: { id: string } | null;
  blog: { id: string; status: string; slug: string } | null;
  workflowRuns: { currentStage: string | null; status: string; failureReason: string | null }[];
}) {
  const latestRun = input.workflowRuns[0] ?? null;
  if (input.status === "PENDING") return "Queued";
  if (input.status === "CANCELLED") return "Cancelled";
  if (input.status === "FAILED") return latestRun?.currentStage ?? "Failed";
  if (input.status === "COMPLETED") return "Published";
  if (!input.plan) return latestRun?.currentStage ?? "Planning";
  if (!input.outline) return latestRun?.currentStage ?? "Outline";
  if (!input.blog) return latestRun?.currentStage ?? "Writing";
  return latestRun?.currentStage ?? input.blog.status;
}

/** Unique slug for the BlogInput table (the Blog table has its own guard). */
async function uniqueInputSlug(base: string): Promise<string> {
  const safeBase = base || "untitled";
  let slug = safeBase;
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const existing = await prisma.blogInput.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
    slug = `${safeBase}-${suffix}`;
  }
  throw new Error(`Failed to generate a unique slug for "${safeBase}"`);
}

/**
 * Accepts a manual blog specification and starts the pipeline.
 *
 * The row is created first and dispatched second, deliberately: if the
 * enqueue fails, the submission still exists as PENDING and the next
 * reconcile tick (or a publish slot) picks it up, instead of the editor's
 * work vanishing with the error.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = blogInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ") },
        { status: 400 }
      );
    }
    const validated = parsed.data;

    const existing = await prisma.blogInput.findUnique({ where: { title: validated.title } });
    if (existing) {
      return NextResponse.json({ error: "A blog with this title has already been submitted" }, { status: 409 });
    }

    const slug = await uniqueInputSlug(validated.slug ? slugifyTitle(validated.slug) : slugifyTitle(validated.title));

    // Reference sources get the [S1]..[Sn] ids the whole grounding stack
    // keys on (workers/shared/evidence.ts), plus the digest the legacy
    // citation/fact-check paths read.
    const sources = validated.sources ?? [];
    const evidenceArticles = sources.map((source, index) => ({
      id: `S${index + 1}`,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      publishedAt: source.publishedAt,
      evidence: source.evidence,
      excerpt: source.excerpt ?? source.evidence.join(" "),
      fetchedAt: new Date().toISOString(),
      extractor: "editor-supplied",
      chars: (source.excerpt ?? source.evidence.join(" ")).length,
    }));
    const evidenceSummary =
      evidenceArticles.length > 0
        ? evidenceArticles
            .map((article) => `- ${article.title} (${article.url})\n${article.evidence.map((fact) => `  - ${fact}`).join("\n")}`)
            .join("\n")
        : null;

    const blogInput = await prisma.blogInput.create({
      data: {
        title: validated.title,
        slug,
        category: validated.category,
        keywords: validated.primaryKeywords,
        secondaryKeywords: validated.secondaryKeywords,
        audience: validated.audience,
        searchIntent: validated.searchIntent,
        tone: validated.tone,
        contentLength: validated.contentLength,
        focusKeyword: validated.focusKeyword,
        metaTitle: validated.metaTitle,
        metaDescription: validated.metaDescription,
        outlineJson: validated.outlineJson,
        evidenceArticles: evidenceArticles.length > 0 ? evidenceArticles : undefined,
        evidenceSummary,
        priority: validated.priority,
        status: "PENDING",
        specs: validated,
      },
    });

    if (validated.startNow) {
      await dispatchBlogInput(blogInput);
      return NextResponse.json({
        success: true,
        id: blogInput.id,
        status: "PROCESSING",
        message: "Blog queued for processing",
      });
    }

    return NextResponse.json({
      success: true,
      id: blogInput.id,
      status: "PENDING",
      message: "Blog saved to the backlog - the next publish slot will pick it up",
    });
  } catch (error) {
    console.error("Blog input error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process blog input" },
      { status: 500 }
    );
  }
}

/** Recent submissions / content plans for the dashboard table. */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const category = req.nextUrl.searchParams.get("category");
  const search = req.nextUrl.searchParams.get("search")?.trim();
  const paged = req.nextUrl.searchParams.get("paged") === "1";
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? req.nextUrl.searchParams.get("limit") ?? 50)));
  const sort = req.nextUrl.searchParams.get("sort") ?? "createdAt";
  const dir = req.nextUrl.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const orderField = VALID_SORTS.has(sort) ? sort : "createdAt";
  const skip = (page - 1) * pageSize;
  const where = {
    ...(status && status !== "all" ? { status: status as never } : {}),
    ...(category && category !== "all"
      ? category === "Uncategorized"
        ? { category: null }
        : { category }
      : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
            { category: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [blogInputs, total, statusCounts, categoryRows] = await Promise.all([
    prisma.blogInput.findMany({
      where,
      take: pageSize,
      skip: paged ? skip : 0,
      orderBy: { [orderField]: dir },
      include: {
        plan: { select: { id: true } },
        outline: { select: { id: true } },
        blog: { select: { id: true, slug: true, status: true } },
        workflowRuns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, currentStage: true, failureReason: true },
        },
      },
    }),
    prisma.blogInput.count({ where }),
    prisma.blogInput.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.blogInput.findMany({ select: { category: true }, distinct: ["category"], orderBy: { category: "asc" } }),
  ]);

  const rows = blogInputs.map((input) => ({
      id: input.id,
      title: input.title,
      slug: input.slug,
      category: input.category,
      status: input.status,
      priority: input.priority,
      failureReason: input.failureReason,
      createdAt: input.createdAt,
      dispatchedAt: input.dispatchedAt,
      processedAt: input.processedAt,
      blog: input.blog,
      planStatus: input.plan ? "READY" : input.status === "PENDING" ? "QUEUED" : "WAITING",
      outlineStatus: input.outline ? "READY" : input.plan ? "WAITING" : "BLOCKED",
      blogStatus: input.blog?.status ?? null,
      currentStage: stageForInput(input),
      workflowStatus: input.workflowRuns[0]?.status ?? null,
      specs: input.specs,
    }));

  if (!paged) return NextResponse.json(rows);

  return NextResponse.json({
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    statuses: statusCounts.map((row) => ({ status: row.status, count: row._count._all })),
    categories: categoryRows.map((row) => row.category ?? "Uncategorized"),
  });
}
