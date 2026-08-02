import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { researchQueue } from "@/workers/shared/queues";
import { allQueueCounts, STAGE_ORDER } from "@/lib/queues";

export const dynamic = "force-dynamic";

/** Fallback estimate, measured from the pricing model, used until real runs exist. */
const FALLBACK_COST_USD = 0.067;
const FALLBACK_DURATION_MS = 3 * 60 * 1000;

const SLOT_LABELS: Record<string, string> = {
  "research-overnight": "Overnight",
  "research-midday": "Midday",
  "research-us-daytime": "US daytime",
};

function slotLabel(key: string) {
  return SLOT_LABELS[key] ?? key.replace(/^research-/, "").replace(/-/g, " ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET() {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [schedulers, queues, workersConnected, lastAttempt, usageRows, passedRuns] =
    await Promise.all([
      researchQueue.getJobSchedulers().catch(() => []),
      allQueueCounts(),
      researchQueue.getWorkersCount().catch(() => 0),
      prisma.workerAttempt.findFirst({
        where: { worker: "research-worker" },
        orderBy: { startedAt: "desc" },
      }),
      prisma.aIUsage.findMany({
        where: { createdAt: { gte: fourteenDaysAgo }, blogId: { not: null } },
        select: { blogId: true, cost: true },
      }),
      prisma.workflowRun.findMany({
        where: { status: "PASSED", createdAt: { gte: fourteenDaysAgo } },
        select: { createdAt: true, updatedAt: true },
        take: 100,
        orderBy: { createdAt: "desc" },
      }),
    ]);

  // Next fire times come straight from BullMQ rather than re-parsing cron, so
  // this reflects what is actually registered in Redis. A stale scheduler that
  // survived the reconcile would show up here instead of staying invisible.
  const schedules = schedulers
    .filter((scheduler) => typeof scheduler.next === "number")
    .map((scheduler) => ({
      id: scheduler.key,
      label: slotLabel(scheduler.key),
      pattern: scheduler.pattern ?? null,
      tz: scheduler.tz ?? null,
      next: scheduler.next as number,
    }))
    .sort((a, b) => a.next - b.next);

  const output = asRecord(lastAttempt?.output);
  const lastRun = lastAttempt
    ? {
        status: lastAttempt.status,
        startedAt: lastAttempt.startedAt.toISOString(),
        finishedAt: lastAttempt.finishedAt?.toISOString() ?? null,
        durationMs: lastAttempt.finishedAt
          ? lastAttempt.finishedAt.getTime() - lastAttempt.startedAt.getTime()
          : null,
        dispatchedCount:
          typeof output.dispatchedCount === "number" ? output.dispatchedCount : null,
        reason: typeof output.reason === "string" ? output.reason : null,
        error: lastAttempt.error,
      }
    : null;

  // Cost per blog = sum of every AI call attributed to that blog, averaged.
  const costByBlog = new Map<string, number>();
  for (const row of usageRows) {
    if (!row.blogId) continue;
    costByBlog.set(row.blogId, (costByBlog.get(row.blogId) ?? 0) + row.cost);
  }
  const blogCosts = [...costByBlog.values()];
  const measuredCost = blogCosts.length
    ? blogCosts.reduce((sum, cost) => sum + cost, 0) / blogCosts.length
    : null;

  const durations = passedRuns
    .map((run) => run.updatedAt.getTime() - run.createdAt.getTime())
    .filter((ms) => ms > 0);
  const measuredDuration = durations.length
    ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length
    : null;

  const costUsd = measuredCost ?? FALLBACK_COST_USD;
  const durationMs = measuredDuration ?? FALLBACK_DURATION_MS;
  const durationMin = durationMs / 60000;

  const research = queues.research;

  return NextResponse.json({
    schedules,
    lastRun,
    queues,
    stageOrder: STAGE_ORDER,
    runInFlight: research.active > 0 || research.waiting > 0 || research.delayed > 0,
    workersConnected,
    estimate: {
      costUsd,
      costLabel: costUsd < 0.01 ? `~$${costUsd.toFixed(4)}` : `~$${costUsd.toFixed(2)}`,
      durationMs,
      durationLabel: durationMin < 1 ? `~${Math.round(durationMs / 1000)}s` : `~${Math.round(durationMin)} min`,
      basedOnRuns: blogCosts.length,
    },
  });
}
