import { NextResponse } from "next/server";
import { JOB_IDS, researchQueue } from "@/workers/shared/queues";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const job = await researchQueue.add("manual-topic-research", { manualTopicId: id, triggeredBy: "topics-pool" }, { jobId: JOB_IDS.manualTopicResearch(id) });
    return NextResponse.json({ ok: true, jobId: job.id, queue: "research_queue" });
  } catch (error) {
    console.error("Failed to queue manual topic research:", error);
    return NextResponse.json({ ok: false, error: "Failed to queue topic research" }, { status: 500 });
  }
}
