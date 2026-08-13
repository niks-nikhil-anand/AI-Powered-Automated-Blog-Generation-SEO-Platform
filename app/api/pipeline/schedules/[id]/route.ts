import { NextResponse } from "next/server";
import {
  clearSlotTime,
  isBlogSlotId,
  slotNumberFromId,
  upsertSlotTime,
} from "@/workers/shared/publish-slots";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Edits one publish slot's TARGET PUBLISH time (blog-slot-<n>, n = 1..20,
 * one per Daily Blog Goal). The time the user picks is when the blog goes
 * live - the BullMQ scheduler actually fires generation earlier by
 * SLOT_GENERATION_LEAD_MINUTES, and quality-worker holds the finished blog
 * until the publish time (publishes immediately if retries already ran
 * past it). The publish time persists in AppSetting, so edits survive
 * worker restarts; Redis stays the live scheduling truth for reads.
 *
 * Body: { hour, minute } = publish time, or { reset: true } to clear the
 * slot (unsets it - the card returns to "--:--" until a new time is set).
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isBlogSlotId(id)) {
      return NextResponse.json({ ok: false, error: `Unknown publish slot "${id}".` }, { status: 404 });
    }
    const n = slotNumberFromId(id);

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    if (body.reset === true) {
      await clearSlotTime(n);
      return NextResponse.json({
        ok: true,
        id,
        label: `Blog #${n}`,
        pattern: null,
        publishTime: null,
        generationStart: null,
        next: null,
        configured: false,
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

    const slot = await upsertSlotTime(n, hour, minute);
    return NextResponse.json({ ok: true, ...slot });
  } catch (error) {
    console.error("Failed to update schedule:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to update schedule" },
      { status: 500 }
    );
  }
}
