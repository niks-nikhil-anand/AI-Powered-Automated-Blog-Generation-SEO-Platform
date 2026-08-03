import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { writingQueue, type WritingJobPayload } from "@/workers/shared/queues";

export const dynamic = "force-dynamic";

/**
 * The real "regenerate" action for a blog that failed the quality gate.
 * There is no per-check auto-fix worker (no such thing exists in this
 * codebase) - what quality-worker actually does on a failing score is
 * requeue the last writing-worker input back to writing_queue, capped at
 * 4 attempts. This route triggers that same recovery path on demand
 * instead of waiting for the next scheduled pass, so the UI can offer a
 * "Regenerate now" button that is honest about what it does.
 */
const MAX_WRITING_ATTEMPTS = 4;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const blog = await prisma.blog.findUnique({ where: { id } });
    if (!blog) {
      return NextResponse.json({ ok: false, error: "Blog not found" }, { status: 404 });
    }

    const workflow = await prisma.workflowRun.findFirst({
      where: { blogId: blog.id },
      orderBy: { createdAt: "desc" },
      include: {
        attempts: {
          where: { worker: "writing-worker" },
          orderBy: { startedAt: "desc" },
        },
      },
    });

    // Use fetched attempts array instead of separate count query (N+1 optimization)
    const writingAttemptCount = workflow?.attempts.length ?? 0;
    const lastWritingInput = workflow?.attempts[0]?.input as WritingJobPayload | undefined;

    if (!lastWritingInput) {
      return NextResponse.json(
        {
          ok: false,
          error: "No writing-worker input found for this article, so it can't be regenerated automatically.",
        },
        { status: 422 }
      );
    }

    if (writingAttemptCount >= MAX_WRITING_ATTEMPTS) {
      return NextResponse.json(
        {
          ok: false,
          error: `Retry budget exhausted (${writingAttemptCount}/${MAX_WRITING_ATTEMPTS} writing attempts). Use manual override instead.`,
        },
        { status: 409 }
      );
    }

    const job = await writingQueue.add("write_blog", {
      ...lastWritingInput,
      recoveryContext: {
        reason: "manual_regenerate_requested",
      },
    });

    await prisma.blog.update({
      where: { id: blog.id },
      data: { status: "PENDING_REVIEW" },
    });

    return NextResponse.json({
      ok: true,
      blogId: blog.id,
      jobId: job.id,
      queue: "writing_queue",
      attempt: writingAttemptCount + 1,
      attemptLimit: MAX_WRITING_ATTEMPTS,
    });
  } catch (error) {
    const err = error as Error & { code?: string };
    if (err?.code && err.message?.includes("Prisma")) {
      console.error("Database error regenerating blog:", err.code, err.message);
      return NextResponse.json(
        { ok: false, error: "Database operation failed" },
        { status: 500 }
      );
    }
    if (err?.message?.includes("queue")) {
      console.error("Queue error regenerating blog:", err.message);
      return NextResponse.json(
        { ok: false, error: "Failed to queue regeneration job" },
        { status: 503 }
      );
    }
    console.error("Unexpected error regenerating blog:", err?.message || error);
    return NextResponse.json(
      { ok: false, error: "Unexpected error during regeneration" },
      { status: 500 }
    );
  }
}
