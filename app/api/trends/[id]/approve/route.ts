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

  const existingPlan = await prisma.contentPlan.findUnique({
    where: { trendId: trend.id },
    select: { id: true },
  });
  if (existingPlan) {
    return NextResponse.json(
      { ok: false, error: "This topic is already in the content pipeline." },
      { status: 409 }
    );
  }

  const job = await planningQueue.add("plan_blog", {
    trendId: trend.id,
    topic: trend.topic,
    category: trend.category,
    score: trend.score,
    evidenceSummary: evidenceSummary(trend),
  });

  await prisma.trend.update({ where: { id }, data: { status: "PLANNED" } });

  return NextResponse.json({
    ok: true,
    trendId: trend.id,
    jobId: job.id,
    queue: "planning_queue",
    status: "PLANNED",
  });
}
