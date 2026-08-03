import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const trend = await prisma.trend.findUnique({ where: { id }, select: { id: true } });

    if (!trend) {
      return NextResponse.json({ ok: false, error: "Trend not found" }, { status: 404 });
    }

    await prisma.trend.delete({ where: { id } });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error("Failed to delete trend:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to delete trend" },
      { status: 500 }
    );
  }
}
