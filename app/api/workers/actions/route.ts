import { NextResponse } from "next/server";
import { QUEUE_BY_NAME, STAGE_ORDER, STAGE_QUEUES } from "@/lib/queues";

export const dynamic = "force-dynamic";

/**
 * Mutations for the Queue & Worker Operations page
 * (docs/workers-page-uiux-plan.md §3.3). All actions are idempotent BullMQ
 * operations over the seven known queues - pause/resume only halts
 * *consumption* (delayed jobs and the research job schedulers still
 * enqueue), and retry moves failed jobs back to waiting. The response
 * `detail` string is shown verbatim in the page's notice modal, so it must
 * always describe what actually happened (including "nothing to do").
 */
export async function POST(req: Request) {
  let body: { action?: string; queue?: string; jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const allQueues = STAGE_ORDER.map((stage) => STAGE_QUEUES[stage]);

  try {
    switch (body.action) {
      case "pause-all":
      case "resume-all": {
        const pausing = body.action === "pause-all";
        await Promise.all(allQueues.map((queue) => (pausing ? queue.pause() : queue.resume())));
        return NextResponse.json({
          ok: true,
          affected: allQueues.length,
          detail: pausing
            ? `Paused all ${allQueues.length} queues - consumption halted; scheduled research jobs will still enqueue.`
            : `Resumed all ${allQueues.length} queues - workers are consuming again.`,
        });
      }

      case "pause-queue":
      case "resume-queue": {
        const queue = body.queue ? QUEUE_BY_NAME[body.queue] : undefined;
        if (!queue) {
          return NextResponse.json({ ok: false, error: "Unknown queue" }, { status: 400 });
        }
        const pausing = body.action === "pause-queue";
        if (pausing) await queue.pause();
        else await queue.resume();
        return NextResponse.json({
          ok: true,
          affected: 1,
          detail: pausing
            ? `Paused ${queue.name} - new jobs will wait until it is resumed.`
            : `Resumed ${queue.name}.`,
        });
      }

      case "retry-all-failed": {
        // getJobs-then-retry per queue (rather than queue.retryJobs) so the
        // modal can report the true number of jobs moved back to waiting.
        let affected = 0;
        let queuesTouched = 0;
        for (const queue of allQueues) {
          const failed = await queue.getJobs(["failed"], 0, 999);
          if (failed.length > 0) queuesTouched += 1;
          await Promise.all(failed.map((job) => job.retry()));
          affected += failed.length;
        }
        return NextResponse.json({
          ok: true,
          affected,
          detail:
            affected > 0
              ? `Moved ${affected} failed job${affected === 1 ? "" : "s"} back to waiting across ${queuesTouched} queue${queuesTouched === 1 ? "" : "s"}.`
              : "No failed jobs to retry - every queue is clean.",
        });
      }

      case "retry-job": {
        const queue = body.queue ? QUEUE_BY_NAME[body.queue] : undefined;
        if (!queue || !body.jobId) {
          return NextResponse.json(
            { ok: false, error: "queue and jobId are required" },
            { status: 400 }
          );
        }
        const job = await queue.getJob(body.jobId);
        if (!job) {
          return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
        }
        await job.retry();
        return NextResponse.json({
          ok: true,
          affected: 1,
          detail: `Re-queued job ${body.jobId} in ${queue.name}.`,
        });
      }

      default:
        return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Worker action failed:", error);
    return NextResponse.json({ ok: false, error: "Worker action failed" }, { status: 500 });
  }
}
