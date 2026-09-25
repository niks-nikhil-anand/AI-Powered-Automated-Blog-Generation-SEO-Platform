import { NextResponse } from "next/server";
import { dispatchOneEligibleBlogNow } from "@/workers/shared/daily-target";
import { refreshRetryAttempts } from "@/workers/shared/retry-config";

export const dynamic = "force-dynamic";

/**
 * "Run pipeline" from the dashboard: runs the same one-blog picker as a
 * scheduled publish slot immediately. It respects the Daily Blog Goal ceiling
 * and selects PENDING first, CANCELLED next, FAILED last.
 *
 * Replaces the old POST /api/research/run, which triggered trend discovery.
 */
export async function POST() {
  try {
    await refreshRetryAttempts().catch(() => {});
    const result = await dispatchOneEligibleBlogNow(Date.now());

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Failed to queue the pipeline run:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to queue the pipeline run" },
      { status: 500 }
    );
  }
}
