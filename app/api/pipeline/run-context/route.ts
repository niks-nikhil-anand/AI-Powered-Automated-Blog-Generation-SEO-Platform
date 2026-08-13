import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { researchQueue } from "@/workers/shared/queues";
import { allQueueCounts, STAGE_ORDER } from "@/lib/queues";
import { env } from "@/workers/shared/env";
import { RECONCILE_SLOT_ID, getPublishSlotView } from "@/workers/shared/publish-slots";

export const dynamic = "force-dynamic";

/** Fallback estimate, measured from the pricing model, used until real runs exist. */
const FALLBACK_COST_USD = 0.067;
const FALLBACK_DURATION_MS = 3 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET() {
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [schedulers, queues, workersConnected, lastAttempt, usageRows, passedRuns, slotView] =
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
      // Dynamic publish slots: exactly one entry per Daily Blog Goal,
      // publish times from AppSetting, next-generation fire times from
      // BullMQ. Unset slots come back with nulls so the UI can render the
      // empty "configure me" card.
      getPublishSlotView(),
    ]);

  const schedules = slotView;
  const reconcileScheduler = schedulers.find((scheduler) => scheduler.key === RECONCILE_SLOT_ID);
  const reconcile = reconcileScheduler
    ? {
        id: RECONCILE_SLOT_ID,
        pattern: reconcileScheduler.pattern ?? null,
        next: typeof reconcileScheduler.next === "number" ? reconcileScheduler.next : null,
      }
    : null;

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
    reconcile,
    lastRun,
    queues,
    stageOrder: STAGE_ORDER,
    // Minutes generation starts before a slot's publish time - the settings
    // page shows this as the "starts ~Xm earlier" note on each slot card.
    slotLeadMinutes: env.SLOT_GENERATION_LEAD_MINUTES,
    // `delayed` deliberately excluded: BullMQ's job scheduler always keeps one
    // delayed placeholder job per registered cron schedule (one per entry in
    // `schedules` above) representing its next future fire time - that's not
    // a run "in progress", it's just sitting there waiting for its turn,
    // sometimes many hours out. With 3 schedules registered, `delayed` is
    // never 0, which made this permanently true and the manual trigger
    // button permanently disabled. `active`/`waiting` are the real signal:
    // a job is actually running, or queued to run immediately.
    runInFlight: research.active > 0 || research.waiting > 0,
    workersConnected,
    estimate: {
      costUsd,
      costLabel: costUsd < 0.01 ? `~$${costUsd.toFixed(4)}` : `~$${costUsd.toFixed(2)}`,
      durationMs,
      durationLabel: durationMin < 1 ? `~${Math.round(durationMs / 1000)}s` : `~${Math.round(durationMin)} min`,
      basedOnRuns: blogCosts.length,
    },
  });
  } catch (error) {
    console.error("Failed to fetch pipeline context:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch pipeline context" },
      { status: 500 }
    );
  }
}
