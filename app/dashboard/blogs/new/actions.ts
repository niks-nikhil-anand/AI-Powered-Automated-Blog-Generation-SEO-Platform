"use server";

import { prisma } from "@/lib/db";
import { dispatchBlogInput } from "@/workers/shared/daily-target";
import { blogInputSchema, slugifyTitle, type BlogInputFormData, type SubmitResult } from "./types";

/**
 * Server action behind the submission form. It validates and persists
 * through the same contract as POST /api/blogs/input; the API route stays
 * for scripted/bulk submissions, this exists so the form doesn't need a
 * fetch round-trip through its own origin.
 */
export async function submitBlogInput(data: BlogInputFormData): Promise<SubmitResult> {
  const parsed = blogInputSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
    };
  }
  const validated = parsed.data;

  try {
    const existing = await prisma.blogInput.findUnique({ where: { title: validated.title } });
    if (existing) {
      return { success: false, error: "A blog with this title has already been submitted" };
    }

    const base = slugifyTitle(validated.slug || validated.title) || "untitled";
    let slug = base;
    for (let suffix = 1; suffix < 100; suffix += 1) {
      const clash = await prisma.blogInput.findUnique({ where: { slug }, select: { id: true } });
      if (!clash) break;
      slug = `${base}-${suffix}`;
    }

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

    // Created first, dispatched second: a failed enqueue leaves the
    // submission PENDING for the next reconcile tick rather than losing it.
    if (validated.startNow) {
      await dispatchBlogInput(blogInput);
      return { success: true, id: blogInput.id, status: "PROCESSING", message: "Blog queued for processing" };
    }

    return {
      success: true,
      id: blogInput.id,
      status: "PENDING",
      message: "Saved to the backlog - the next publish slot will pick it up",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to submit blog specification",
    };
  }
}
