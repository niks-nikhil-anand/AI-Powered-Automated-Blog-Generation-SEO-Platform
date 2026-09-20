import { NextResponse } from "next/server";
import { JOB_IDS, schedulerQueue } from "@/workers/shared/queues";
import { refreshRetryAttempts } from "@/workers/shared/retry-config";

export const dynamic = "force-dynamic";

/**
 * "Run pipeline" from the dashboard: fires the daily-target reconcile tick
 * immediately instead of waiting for its cron. The tick dispatches PENDING
 * blog submissions from the backlog up to the Daily Blog Goal - it does not
 * invent work, so pressing this with an empty backlog is a no-op that says
 * so in the worker log.
 *
 * Replaces the old POST /api/research/run, which triggered trend discovery.
 */
export async function POST() {
  try {
    // The queue's attempts getter reads this process's cache - make sure a
    // manual run always enqueues with the latest Settings retry value.
    await refreshRetryAttempts().catch(() => {});
    // Minute-window jobId: double-clicking "Run" while a run is starting
    // dedupes; a deliberate second run a minute later goes through.
    const job = await schedulerQueue.add(
      "reconcile-daily-target",
      {
        triggeredBy: "dashboard",
        triggeredAt: new Date().toISOString(),
      },
      { jobId: JOB_IDS.manualReconcile() }
    );

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      queue: "scheduler_queue",
    });
  } catch (error) {
    console.error("Failed to queue the pipeline run:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to queue the pipeline run" },
      { status: 500 }
    );
  }
}
