import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import { blogInputSchema, slugifyTitle, type BlogInputFormData } from "@/app/dashboard/blogs/new/types";
import { dispatchBlogInput } from "@/workers/shared/daily-target";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function evidenceFromSources(sources: NonNullable<BlogInputFormData["sources"]>) {
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
  return { evidenceArticles, evidenceSummary };
}

async function uniqueInputSlug(base: string, currentId: string): Promise<string> {
  const safeBase = base || "untitled";
  let slug = safeBase;
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const existing = await prisma.blogInput.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === currentId) return slug;
    slug = `${safeBase}-${suffix}`;
  }
  throw new Error(`Failed to generate a unique slug for "${safeBase}"`);
}

/** One submission with everything the detail view needs. */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const input = await prisma.blogInput.findUnique({
    where: { id },
    include: {
      blog: { select: { id: true, slug: true, status: true, title: true } },
      plan: { select: { id: true, searchIntent: true, audience: true, angle: true, primaryKeyword: true } },
      outline: { select: { id: true, title: true, sections: true, faqs: true } },
      workflowRuns: {
        orderBy: { createdAt: "desc" },
        include: { attempts: { orderBy: { startedAt: "desc" } } },
      },
    },
  });
  if (!input) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  return NextResponse.json(input);
}

/**
 * Two editor actions on a submission:
 *  - "start": dispatch a PENDING row now instead of waiting for its slot.
 *  - "retry": re-dispatch a FAILED row. Only the BlogInput status is reset -
 *    any plan/outline/blog rows it already produced are left alone, because
 *    every stage upserts on blogInputId and will overwrite them in place.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const { action } = body as { action?: string };

    const input = await prisma.blogInput.findUnique({ where: { id }, include: { blog: { select: { id: true } } } });
    if (!input) return NextResponse.json({ error: "Submission not found" }, { status: 404 });

    if (action === "cancel") {
      if (input.status === "COMPLETED") {
        return NextResponse.json({ error: "This submission already published - nothing to cancel" }, { status: 409 });
      }
      // Queued jobs aren't removed: each worker checks for CANCELLED at the
      // top of its handler and stops the chain there, which is race-free
      // whether or not a job is mid-flight right now.
      const updated = await prisma.blogInput.update({
        where: { id },
        data: { status: "CANCELLED", processedAt: new Date() },
      });
      return NextResponse.json({ ok: true, status: updated.status });
    }

    if (action === "start" || action === "retry") {
      if (input.status === "PROCESSING") {
        return NextResponse.json({ error: "This submission is already in the pipeline" }, { status: 409 });
      }
      if (input.status === "COMPLETED") {
        return NextResponse.json({ error: "This submission already published" }, { status: 409 });
      }
      await dispatchBlogInput(input);
      return NextResponse.json({ ok: true, status: "PROCESSING" });
    }

    if (action) return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });

    if (input.blog) {
      return NextResponse.json({ error: "This submission already produced a blog - create a new plan instead" }, { status: 409 });
    }
    if (input.status === "PROCESSING") {
      return NextResponse.json({ error: "This submission is already in the pipeline - cancel or wait before editing" }, { status: 409 });
    }

    const parsed = blogInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ") },
        { status: 400 }
      );
    }
    const validated = parsed.data;

    const titleClash = await prisma.blogInput.findFirst({
      where: { title: validated.title, NOT: { id } },
      select: { id: true },
    });
    if (titleClash) {
      return NextResponse.json({ error: "A different content plan already uses this title" }, { status: 409 });
    }

    const slug = await uniqueInputSlug(validated.slug ? slugifyTitle(validated.slug) : slugifyTitle(validated.title), id);
    const { evidenceArticles, evidenceSummary } = evidenceFromSources(validated.sources ?? []);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.contentPlan.deleteMany({ where: { blogInputId: id } });
      return tx.blogInput.update({
        where: { id },
        data: {
          title: validated.title,
          slug,
          category: validated.category ?? null,
          keywords: validated.primaryKeywords,
          secondaryKeywords: validated.secondaryKeywords,
          audience: validated.audience ?? null,
          searchIntent: validated.searchIntent ?? null,
          tone: validated.tone,
          contentLength: validated.contentLength,
          focusKeyword: validated.focusKeyword ?? null,
          metaTitle: validated.metaTitle ?? null,
          metaDescription: validated.metaDescription ?? null,
          outlineJson: validated.outlineJson ?? Prisma.JsonNull,
          evidenceArticles: evidenceArticles.length > 0 ? evidenceArticles : Prisma.JsonNull,
          evidenceSummary,
          priority: validated.priority,
          status: "PENDING",
          failureReason: null,
          processedAt: null,
          dispatchedAt: null,
          specs: validated,
        },
      });
    });

    return NextResponse.json({ success: true, id: updated.id, status: updated.status, message: "Content plan updated" });
  } catch (error) {
    console.error("Failed to update blog submission:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update blog submission" },
      { status: 500 }
    );
  }
}

/** Hard-delete a submission that never produced anything worth keeping. */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const input = await prisma.blogInput.findUnique({ where: { id }, include: { blog: { select: { id: true } } } });
    if (!input) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    if (input.blog) {
      return NextResponse.json(
        { error: "This submission already produced a blog - cancel it instead of deleting it" },
        { status: 409 }
      );
    }
    await prisma.blogInput.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete blog submission:", error);
    return NextResponse.json({ error: "Failed to delete blog submission" }, { status: 500 });
  }
}
