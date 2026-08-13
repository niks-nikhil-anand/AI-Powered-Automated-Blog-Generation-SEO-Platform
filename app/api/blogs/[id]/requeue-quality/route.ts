import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { JOB_IDS, qualityQueue } from "@/workers/shared/queues";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Real "Re-run QA" action - enqueues the same job image-worker enqueues on completion. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const blog = await prisma.blog.findUnique({ where: { id } });
    if (!blog) {
      return NextResponse.json({ ok: false, error: "Blog not found" }, { status: 404 });
    }

    // Unique per click on purpose: every manual re-run is a legitimate new
    // scoring run (the QA report upsert makes repeats idempotent).
    const job = await qualityQueue.add(
      "quality_check_blog",
      { blogId: blog.id },
      { jobId: JOB_IDS.qualityManual(blog.id) }
    );

    return NextResponse.json({
      ok: true,
      blogId: blog.id,
      jobId: job.id,
      queue: "quality_queue",
    });
  } catch (error) {
    console.error("Failed to requeue quality check:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to requeue quality check" },
      { status: 500 }
    );
  }
}
