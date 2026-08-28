import { NextRequest, NextResponse } from "next/server";
import { getObservabilityDashboard, type ObservabilityRange } from "@/lib/langfuse-analytics";

export const dynamic = "force-dynamic";

const ranges = new Set<ObservabilityRange>(["15m", "1h", "6h", "24h", "7d", "30d"]);

export async function GET(request: NextRequest) {
  const rangeValue = request.nextUrl.searchParams.get("range") ?? "24h";
  const range: ObservabilityRange = ranges.has(rangeValue as ObservabilityRange) ? rangeValue as ObservabilityRange : "24h";
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  return NextResponse.json(await getObservabilityDashboard({ range, cursor }));
}
