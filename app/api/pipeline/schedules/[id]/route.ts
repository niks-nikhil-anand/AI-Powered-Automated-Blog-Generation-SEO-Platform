import { NextResponse } from "next/server";
import { env } from "@/workers/shared/env";
import { researchQueue } from "@/workers/shared/queues";

export const dynamic = "force-dynamic";

/**
 * The three ids research-worker actually registers at boot
 * (workers/research-worker/index.ts RESEARCH_SLOTS). Duplicated here rather
 * than imported from that file, since importing a worker's entrypoint would
 * also pull in its BullMQ Worker() consumer - this route only needs to talk
 * to the scheduler, not become a second consumer of the queue.
 */
const SLOT_LABELS: Record<string, string> = {
  "research-overnight": "Overnight sweep",
  "research-midday": "Midday",
  "research-us-daytime": "US daytime",
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!SLOT_LABELS[id]) {
      return NextResponse.json({ ok: false, error: `Unknown schedule "${id}".` }, { status: 404 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const hour = Number(body.hour);
    const minute = Number(body.minute);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      return NextResponse.json(
        { ok: false, error: "hour must be 0-23 and minute must be 0-59." },
        { status: 422 }
      );
    }

    const pattern = `${minute} ${hour} * * *`;

    // upsertJobScheduler is idempotent and takes effect immediately in
    // Redis - no worker restart needed, the next fire time recalculates as
    // soon as this resolves.
    await researchQueue.upsertJobScheduler(
      id,
      { pattern, tz: env.TIMEZONE },
      { name: "scheduled-research", data: { slot: id } }
    );

    const schedulers = await researchQueue.getJobSchedulers();
    const updated = schedulers.find((scheduler) => scheduler.key === id);

    return NextResponse.json({
      ok: true,
      id,
      label: SLOT_LABELS[id],
      pattern,
      tz: env.TIMEZONE,
      next: updated?.next ?? null,
    });
  } catch (error) {
    console.error("Failed to update schedule:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to update schedule" },
      { status: 500 }
    );
  }
}
