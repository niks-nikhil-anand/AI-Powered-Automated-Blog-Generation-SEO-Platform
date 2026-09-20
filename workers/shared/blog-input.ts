import { prisma } from "./prisma";

/**
 * BlogInput status transitions, in one place so every stage spells them the
 * same way. The lifecycle is:
 *
 *   PENDING -> PROCESSING (dispatchBlogInput, workers/shared/daily-target.ts)
 *           -> COMPLETED  (publish-worker, once the blog is live)
 *           -> FAILED     (any stage that threw)
 *
 * A FAILED row is not terminal while BullMQ still has retries left: the next
 * attempt writes PROCESSING again on its way through. The dashboard therefore
 * shows the honest current state ("the last attempt failed, with this
 * reason") rather than pretending a stalled submission is still moving.
 *
 * None of these throw. A status write is bookkeeping - it must never be the
 * reason a job fails, and never the reason a failing job's real error is
 * swallowed.
 */
export async function failBlogInput(blogInputId: string | undefined | null, error: unknown) {
  if (!blogInputId) return;
  const failureReason = error instanceof Error ? error.message : String(error);
  try {
    await prisma.blogInput.update({
      where: { id: blogInputId },
      data: { status: "FAILED", failureReason: failureReason.slice(0, 2000) },
    });
  } catch {
    // Best-effort.
  }
}

export async function completeBlogInput(blogInputId: string | undefined | null) {
  if (!blogInputId) return;
  try {
    await prisma.blogInput.update({
      where: { id: blogInputId },
      data: { status: "COMPLETED", processedAt: new Date(), failureReason: null },
    });
  } catch {
    // Best-effort.
  }
}

/** Slug-safe form of a title, shared by the submit API and the workers. */
export function slugifyTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}
