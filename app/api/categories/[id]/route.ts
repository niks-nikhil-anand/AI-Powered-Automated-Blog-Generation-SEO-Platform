import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { categoryError, categoryPatchSchema, slugifyCategory } from "@/lib/categories";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const category = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { blogs: true, blogInputs: true } } } });
    if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    return NextResponse.json({ category });
  } catch (error) {
    const result = categoryError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = categoryPatchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid category" }, { status: 400 });
    const data = parsed.data;
    const category = await prisma.category.update({
      where: { id },
      data: {
        ...data,
        ...(data.name && !data.slug ? { slug: slugifyCategory(data.name) } : {}),
        ...(data.description !== undefined ? { description: data.description || null } : {}),
        ...(data.slug !== undefined ? { slug: slugifyCategory(data.slug || data.name || "category") } : {}),
      },
    });
    return NextResponse.json({ category });
  } catch (error) {
    const result = categoryError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const category = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { blogs: true, blogInputs: true } } } });
    if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    if (category._count.blogs > 0 || category._count.blogInputs > 0) {
      return NextResponse.json({ error: "This category is in use. Deactivate it instead of deleting it." }, { status: 409 });
    }
    await prisma.category.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const result = categoryError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
