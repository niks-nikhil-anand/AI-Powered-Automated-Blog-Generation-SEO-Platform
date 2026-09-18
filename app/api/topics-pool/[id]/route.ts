import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };
const statuses = new Set(["PENDING", "RESEARCHING", "QUALIFIED", "SELECTED", "USED", "REJECTED", "ARCHIVED"]);
const priorities = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);

function patchOf(value: unknown) {
  const body = value as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if (typeof body.description === "string") data.description = body.description.trim() || null;
  if (Array.isArray(body.keywords)) data.keywords = body.keywords.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 20);
  if (typeof body.category === "string") data.category = body.category.trim() || null;
  if (typeof body.notes === "string") data.notes = body.notes.trim() || null;
  if (typeof body.status === "string" && statuses.has(body.status)) data.status = body.status;
  if (typeof body.priority === "string" && priorities.has(body.priority)) data.priority = body.priority;
  return data;
}

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const topic = await prisma.manualTopic.findUnique({ where: { id } });
  return topic ? NextResponse.json({ topic }) : NextResponse.json({ ok: false, error: "Topic not found" }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const topic = await prisma.manualTopic.update({ where: { id }, data: patchOf(await request.json()) as never });
    return NextResponse.json({ ok: true, topic });
  } catch (error) {
    console.error("Failed to update manual topic:", error);
    return NextResponse.json({ ok: false, error: "Failed to update topic" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await prisma.manualTopic.update({ where: { id }, data: { status: "ARCHIVED" } });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error("Failed to archive manual topic:", error);
    return NextResponse.json({ ok: false, error: "Failed to archive topic" }, { status: 500 });
  }
}
