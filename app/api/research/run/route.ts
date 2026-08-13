import { NextResponse } from "next/server";
import { researchQueue } from "@/workers/shared/queues";
import { refreshRetryAttempts } from "@/workers/shared/retry-config";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // The queue's attempts getter reads this process's cache - make sure a
    // manual run always enqueues with the latest Settings retry value.
    await refreshRetryAttempts().catch(() => {});
    const job = await researchQueue.add("manual-research", {
      triggeredBy: "dashboard",
      triggeredAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      queue: "research_queue",
    });
  } catch (error) {
    console.error("Failed to queue research:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to queue research job" },
      { status: 500 }
    );
  }
}
