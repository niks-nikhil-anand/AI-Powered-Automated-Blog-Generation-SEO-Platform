import { z } from "zod";

export const categoryInputSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80, "Name must be 80 characters or fewer"),
  slug: z.string().trim().max(90).optional().or(z.literal("")),
  description: z.string().trim().max(240, "Description must be 240 characters or fewer").optional().or(z.literal("")),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value").default("#6366f1"),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export const categoryPatchSchema = categoryInputSchema.partial();

export function slugifyCategory(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "category";
}

export function categoryError(error: unknown) {
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
    return { error: "A category with this name or slug already exists", status: 409 };
  }
  return { error: error instanceof Error ? error.message : "Category request failed", status: 500 };
}
