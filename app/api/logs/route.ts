import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

/** CloudWatch-style relative presets, resolved server-side against `now`. "all" (or an unknown value) means no time filter. */
const RANGE_MS: Record<string, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function csv(value: string | null): string[] {
  return value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
}

/**
 * First filtering/pagination API route in this codebase - every existing
 * list page does one unfiltered `findMany` and filters/paginates the array
 * client-side. That doesn't scale for logs, which grow unbounded once
 * workers/shared/log-transport.ts is actually writing to LogEntry.
 *
 * Cursor-based (not page-numbered) on purpose: app/dashboard/logs polls this
 * with auto-refresh on, and numbered pages shift under a live-updating feed
 * in a way a "load older" cursor append doesn't.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const levels = csv(params.get("level")).map((l) => l.toUpperCase());
    const workers = csv(params.get("worker"));
    const q = params.get("q")?.trim();
    const range = params.get("range");
    const cursor = params.get("cursor");
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit")) || DEFAULT_LIMIT));

    const where: Prisma.LogEntryWhereInput = {};
    if (levels.length > 0) where.level = { in: levels };
    if (workers.length > 0) where.worker = { in: workers };
    if (q) {
      where.OR = [
        { message: { contains: q, mode: "insensitive" } },
        { stack: { contains: q, mode: "insensitive" } },
      ];
    }
    if (range && range !== "all" && RANGE_MS[range]) {
      where.timestamp = { gte: new Date(Date.now() - RANGE_MS[range]) };
    }

    const rows = await prisma.logEntry.findMany({
      where,
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      logs: page.map((row) => ({
        id: row.id,
        timestamp: row.timestamp.toISOString(),
        level: row.level,
        worker: row.worker,
        message: row.message,
        stack: row.stack,
        meta: row.meta,
        workflowRunId: row.workflowRunId,
        trendId: row.trendId,
        blogId: row.blogId,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (error) {
    console.error("Failed to fetch logs:", error);
    return NextResponse.json({ ok: false, error: "Failed to fetch logs" }, { status: 500 });
  }
}
