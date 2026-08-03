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
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
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
}
