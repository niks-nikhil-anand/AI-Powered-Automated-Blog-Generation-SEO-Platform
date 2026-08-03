import { NextResponse } from "next/server";
import { researchQueue } from "@/workers/shared/queues";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
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
