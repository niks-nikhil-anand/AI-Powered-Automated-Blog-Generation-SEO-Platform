import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const priorities = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);

function parseKeywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 20);
  if (typeof value === "string") return value.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 20);
  return [];
}

function bodyOf(value: unknown) {
  const body = value as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const priority = typeof body.priority === "string" && priorities.has(body.priority) ? body.priority : "NORMAL";
  return {
    title,
    description: typeof body.description === "string" ? body.description.trim() || null : null,
    keywords: parseKeywords(body.keywords),
    category: typeof body.category === "string" ? body.category.trim() || null : null,
    priority,
    notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const status = params.get("status") || undefined;
  const priority = params.get("priority") || undefined;
  const category = params.get("category") || undefined;
  const search = params.get("q")?.trim();
  const [topics, pending, highPriority, used, archived] = await Promise.all([
    prisma.manualTopic.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(priority ? { priority: priority as never } : {}),
      ...(category ? { category } : {}),
      ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    }),
    prisma.manualTopic.count({ where: { status: "PENDING" } }),
    prisma.manualTopic.count({ where: { priority: { in: ["HIGH", "URGENT"] } } }),
    prisma.manualTopic.count({ where: { status: "USED" } }),
    prisma.manualTopic.count({ where: { status: "ARCHIVED" } }),
  ]);
  return NextResponse.json({ topics, stats: { pending, highPriority, used, archived } });
}

export async function POST(request: Request) {
  try {
    const input = bodyOf(await request.json());
    if (!input.title) return NextResponse.json({ ok: false, error: "Topic title is required" }, { status: 400 });
    const topic = await prisma.manualTopic.create({ data: input as never });
    return NextResponse.json({ ok: true, topic }, { status: 201 });
  } catch (error) {
    console.error("Failed to create manual topic:", error);
    return NextResponse.json({ ok: false, error: "Failed to create topic" }, { status: 500 });
  }
}
