import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Manual override for an article that never passed the quality gate.
 * There is no dedicated audit-trail table on Blog, so this writes to
 * LogEntry (already used for persisted worker logs) instead of adding a
 * migration - level "WARN" keeps it visible in the same place other
 * worker warnings show up, tagged with worker "manual-override" so it's
 * filterable.
 */
type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    let body: Record<string, unknown> = {};

    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    const blog = await prisma.blog.findUnique({
      where: { id },
      include: { qualityReport: true },
    });
    if (!blog) {
      return NextResponse.json({ ok: false, error: "Blog not found" }, { status: 404 });
    }

    if (blog.status === "PUBLISHED") {
      return NextResponse.json({ ok: false, error: "This article is already published." }, { status: 409 });
    }

    const report = blog.qualityReport;
    if (!report) {
      return NextResponse.json(
        { ok: false, error: "This article hasn't been quality-scored yet - it will auto-publish if it passes, once quality-worker runs." },
        { status: 422 }
      );
    }

    // Override is a manual pass for borderline articles only - never a
    // backdoor to hit a publishing target. Below 85, or blocked by the
    // fact-check hard gate (see quality-worker/scorer.ts), needs a real
    // rewrite instead. A report with `passed: true` skips these checks -
    // that's the normal "publish now" path, not an override.
    if (!report.passed) {
      if (report.recommendation === "Blocked - unverified facts") {
        return NextResponse.json(
          { ok: false, error: "Override isn't available - the fact-check found unsupported claims. This needs a rewrite, not a manual pass." },
          { status: 422 }
        );
      }
      if (report.overallScore < 85) {
        return NextResponse.json(
          { ok: false, error: `Override isn't available below a score of 85 (this article scored ${report.overallScore}) - it needs a rewrite, not a manual pass.` },
          { status: 422 }
        );
      }
    }

    if (!reason) {
      return NextResponse.json(
        { ok: false, error: "A reason is required to override the quality gate." },
        { status: 422 }
      );
    }

    await prisma.blog.update({
      where: { id: blog.id },
      data: { status: "PUBLISHED" },
    });

    await prisma.logEntry.create({
      data: {
        level: "WARN",
        worker: "manual-override",
        message: `Quality gate manually overridden for "${blog.title}" and published without passing (score ${blog.qualityReport?.overallScore ?? "unknown"}).`,
        blogId: blog.id,
        meta: {
          reason,
          previousStatus: blog.status,
          previousScore: blog.qualityReport?.overallScore ?? null,
        },
      },
    });

    return NextResponse.json({ ok: true, blogId: blog.id, status: "PUBLISHED" });
  } catch (error) {
    console.error("Failed to override publish:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to override publish" },
      { status: 500 }
    );
  }
}
