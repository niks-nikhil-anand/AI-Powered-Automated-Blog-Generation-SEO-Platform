import { NextResponse } from "next/server";
import { researchQueue } from "@/workers/shared/queues";

export const dynamic = "force-dynamic";

export async function POST() {
  const job = await researchQueue.add("manual-research", {
    triggeredBy: "dashboard",
    triggeredAt: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    queue: "research_queue",
  });
}
