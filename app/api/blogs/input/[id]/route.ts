import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dispatchBlogInput } from "@/workers/shared/daily-target";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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
    const { action } = (await request.json()) as { action?: string };

    const input = await prisma.blogInput.findUnique({ where: { id } });
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

    return NextResponse.json({ error: `Unknown action "${action ?? ""}"` }, { status: 400 });
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
