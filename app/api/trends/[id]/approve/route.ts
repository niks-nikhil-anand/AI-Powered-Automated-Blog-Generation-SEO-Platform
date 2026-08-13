import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/workers/shared/env";
import { JOB_IDS, planningQueue } from "@/workers/shared/queues";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function evidenceSummary(
  trend: { topic: string; source: string; category: string; score: number },
  overrideReason: string | null
) {
  const lines = [
    "Manually approved from the Trend Research dashboard.",
    "",
    `Topic: ${trend.topic}`,
    `Source: ${trend.source}`,
    `Category: ${trend.category}`,
    `Score: ${Math.round(trend.score)}`,
  ];
  if (overrideReason) {
    lines.push(
      "",
      `NOTE: this score is below the ${env.RESEARCH_MIN_SCORE_TO_WRITE} write threshold - a human approved it anyway.`,
      `Override reason: ${overrideReason}`
    );
  }
  return lines.join("\n");
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // No body is fine - reason is only required for the below-threshold path.
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    const trend = await prisma.trend.findUnique({ where: { id } });

    if (!trend) {
      return NextResponse.json({ ok: false, error: "Trend not found" }, { status: 404 });
    }

    const belowThreshold = trend.score < env.RESEARCH_MIN_SCORE_TO_WRITE;
    if (belowThreshold && !reason) {
      return NextResponse.json(
        {
          ok: false,
          error: `This topic scored ${Math.round(trend.score)}, below the ${env.RESEARCH_MIN_SCORE_TO_WRITE} write threshold. A reason is required to approve it anyway.`,
        },
        { status: 422 }
      );
    }

    // Use transaction to make check-and-create atomic, preventing race conditions
    // where concurrent requests both pass the check and violate the unique constraint.
    try {
      await prisma.$transaction(async (tx) => {
        const existingPlan = await tx.contentPlan.findUnique({
          where: { trendId: trend.id },
          select: { id: true },
        });
        if (existingPlan) {
          throw new Error("ALREADY_PLANNED");
        }

        await tx.trend.update({
          where: { id },
          data: {
            status: "PLANNED",
            ...(belowThreshold ? { manuallyApproved: true } : {}),
          },
        });
      });
    } catch (txError) {
      if (txError instanceof Error && txError.message === "ALREADY_PLANNED") {
        return NextResponse.json(
          { ok: false, error: "This topic is already in the content pipeline." },
          { status: 409 }
        );
      }
      throw txError;
    }

    // Audit trail for the override - same worker tag
    // app/api/blogs/[id]/override-publish/route.ts already uses, so both
    // kinds of manual override group together under one filter on
    // /dashboard/logs.
    if (belowThreshold) {
      await prisma.logEntry.create({
        data: {
          level: "WARN",
          worker: "manual-override",
          trendId: trend.id,
          message: `Trend "${trend.topic}" manually approved into the pipeline below the ${env.RESEARCH_MIN_SCORE_TO_WRITE} write threshold (score ${Math.round(trend.score)}).`,
          meta: { reason, score: trend.score, threshold: env.RESEARCH_MIN_SCORE_TO_WRITE },
        },
      });
    }

    // Queue the job after the transaction succeeds. Deterministic jobId
    // matches the pipeline convention: one planning job per trend, ever -
    // queue-level backup for the ALREADY_PLANNED transaction guard above.
    const job = await planningQueue.add(
      "plan_blog",
      {
        trendId: trend.id,
        topic: trend.topic,
        category: trend.category,
        score: trend.score,
        evidenceSummary: evidenceSummary(trend, belowThreshold ? reason : null),
      },
      { jobId: JOB_IDS.plan(trend.id) }
    );

    return NextResponse.json({
      ok: true,
      trendId: trend.id,
      jobId: job.id,
      queue: "planning_queue",
      status: "PLANNED",
    });
  } catch (error) {
    const err = error as Error & { code?: string };
    if (err?.code && err.message?.includes("Prisma")) {
      console.error("Database error approving trend:", err.code, err.message);
      return NextResponse.json(
        { ok: false, error: "Database operation failed" },
        { status: 500 }
      );
    }
    if (err?.message?.includes("queue")) {
      console.error("Queue error approving trend:", err.message);
      return NextResponse.json(
        { ok: false, error: "Failed to queue planning job" },
        { status: 503 }
      );
    }
    console.error("Unexpected error approving trend:", err?.message || error);
    return NextResponse.json(
      { ok: false, error: "Unexpected error during approval" },
      { status: 500 }
    );
  }
}
