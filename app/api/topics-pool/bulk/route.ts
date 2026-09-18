import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { ids?: unknown; action?: string; priority?: string };
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (ids.length === 0) return NextResponse.json({ ok: false, error: "No topics selected" }, { status: 400 });
    if (body.action === "archive") await prisma.manualTopic.updateMany({ where: { id: { in: ids } }, data: { status: "ARCHIVED" } });
    else if (body.action === "priority" && ["LOW", "NORMAL", "HIGH", "URGENT"].includes(body.priority ?? "")) await prisma.manualTopic.updateMany({ where: { id: { in: ids } }, data: { priority: body.priority as never } });
    else return NextResponse.json({ ok: false, error: "Unsupported bulk action" }, { status: 400 });
    return NextResponse.json({ ok: true, count: ids.length });
  } catch (error) {
    console.error("Failed bulk topic action:", error);
    return NextResponse.json({ ok: false, error: "Bulk action failed" }, { status: 500 });
  }
}
