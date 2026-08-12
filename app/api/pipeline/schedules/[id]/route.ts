import { NextResponse } from "next/server";
import { env } from "@/workers/shared/env";
import { researchQueue } from "@/workers/shared/queues";
import { deleteSetting, setSetting } from "@/workers/shared/settings";
import {
  RESEARCH_SLOT_LABELS,
  envPatternForSlot,
  isResearchSlotId,
  scheduleSettingKey,
} from "@/workers/shared/research-slots";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Edits one of the three research-worker schedule slots. The live schedule
 * is BullMQ's Job Scheduler in Redis - `upsertJobScheduler` is idempotent
 * and takes effect immediately (no worker restart, next fire time
 * recalculates as soon as it resolves). The chosen pattern is ALSO persisted
 * to AppSetting (`schedule:<slotId>`) because registerSchedules() re-upserts
 * at every worker boot: without the persisted override, a restart silently
 * reverted dashboard edits back to the RESEARCH_CRON_* env defaults. Boot
 * reads AppSetting first, env var as fallback - so Redis is the live truth
 * for reads and AppSetting is only the boot-time override.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isResearchSlotId(id)) {
      return NextResponse.json({ ok: false, error: `Unknown schedule "${id}".` }, { status: 404 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    // Reset path: drop the persisted override and re-upsert the env default.
    if (body.reset === true) {
      const pattern = envPatternForSlot(id);
      await deleteSetting(scheduleSettingKey(id));
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
        label: RESEARCH_SLOT_LABELS[id],
        pattern,
        tz: env.TIMEZONE,
        next: updated?.next ?? null,
        overridden: false,
      });
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

    await researchQueue.upsertJobScheduler(
      id,
      { pattern, tz: env.TIMEZONE },
      { name: "scheduled-research", data: { slot: id } }
    );
    await setSetting(scheduleSettingKey(id), pattern);

    const schedulers = await researchQueue.getJobSchedulers();
    const updated = schedulers.find((scheduler) => scheduler.key === id);

    return NextResponse.json({
      ok: true,
      id,
      label: RESEARCH_SLOT_LABELS[id],
      pattern,
      tz: env.TIMEZONE,
      next: updated?.next ?? null,
      overridden: true,
    });
  } catch (error) {
    console.error("Failed to update schedule:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to update schedule" },
      { status: 500 }
    );
  }
}
