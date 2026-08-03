import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/workers/shared/env";
import { planningQueue } from "@/workers/shared/queues";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function evidenceSummary(trend: { topic: string; source: string; category: string; score: number }) {
  return [
    "Manually approved from the Trend Research dashboard.",
    "",
    `Topic: ${trend.topic}`,
    `Source: ${trend.source}`,
    `Category: ${trend.category}`,
    `Score: ${Math.round(trend.score)}`,
  ].join("\n");
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const trend = await prisma.trend.findUnique({ where: { id } });

    if (!trend) {
      return NextResponse.json({ ok: false, error: "Trend not found" }, { status: 404 });
    }

    if (trend.score < env.RESEARCH_MIN_SCORE_TO_WRITE) {
      return NextResponse.json(
        {
          ok: false,
          error: `Only topics with score >= ${env.RESEARCH_MIN_SCORE_TO_WRITE} can enter writing. This topic score is ${Math.round(trend.score)}.`,
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

        await tx.trend.update({ where: { id }, data: { status: "PLANNED" } });
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

    // Queue the job after the transaction succeeds
    const job = await planningQueue.add("plan_blog", {
      trendId: trend.id,
      topic: trend.topic,
      category: trend.category,
      score: trend.score,
      evidenceSummary: evidenceSummary(trend),
    });

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
