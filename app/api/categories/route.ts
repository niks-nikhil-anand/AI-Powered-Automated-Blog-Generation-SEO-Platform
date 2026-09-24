import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { categoryError, categoryInputSchema, slugifyCategory } from "@/lib/categories";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const search = params.get("search")?.trim() ?? "";
    const active = params.get("active");
    const page = Math.max(1, Number(params.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize") ?? 50)));
    const where = {
      ...(active === "true" ? { isActive: true } : active === "false" ? { isActive: false } : {}),
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { slug: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const [categories, total] = await Promise.all([
      prisma.category.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { blogs: true, blogInputs: true } } },
      }),
      prisma.category.count({ where }),
    ]);
    return NextResponse.json({ categories, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    const result = categoryError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = categoryInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid category" }, { status: 400 });
    const data = parsed.data;
    const slug = slugifyCategory(data.slug || data.name);
    const category = await prisma.category.create({
      data: { ...data, slug, description: data.description || null },
    });
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    const result = categoryError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
