import { env } from "./env";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { JOB_IDS, planningQueue, outlineQueue, writingQueue } from "./queues";
import { getSetting, DAILY_TARGET_KEY } from "./settings";
import { ELIGIBLE_BACKLOG_STATUSES, compareBacklogCandidates } from "./backlog-selection";

const log = logger.child({ worker: "daily-target" });

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export type DailyTargetStatus = {
  target: number;
  publishedToday: number;
  inFlight: number;
  remaining: number;
  backlogAvailable: number;
  backlogPending: number;
  backlogCancelled: number;
  backlogFailed: number;
};

/**
 * publishedToday + inFlight (DRAFT/PENDING_REVIEW - the two non-terminal
 * BlogStatus values) tells us how close today already is to target without
 * double-counting: a blog that later publishes drops out of inFlight and
 * into publishedToday, a blog that permanently fails drops out of both.
 *
 * backlogAvailable is the reusable submission backlog: PENDING rows first,
 * then CANCELLED rows, then FAILED rows as last-resort backfill.
 */
export async function getDailyTargetStatus(): Promise<DailyTargetStatus> {
  const target = await getSetting(DAILY_TARGET_KEY, env.DAILY_BLOG_TARGET);
  const [publishedToday, inFlight, backlogCounts] = await Promise.all([
    prisma.blog.count({ where: { status: "PUBLISHED", updatedAt: { gte: startOfToday() } } }),
    prisma.blog.count({ where: { status: { in: ["DRAFT", "PENDING_REVIEW"] } } }),
    prisma.blogInput.groupBy({
      by: ["status"],
      where: { status: { in: [...ELIGIBLE_BACKLOG_STATUSES] } },
      _count: { _all: true },
    }),
  ]);
  const countFor = (status: string) => backlogCounts.find((row) => row.status === status)?._count._all ?? 0;
  const backlogPending = countFor("PENDING");
  const backlogCancelled = countFor("CANCELLED");
  const backlogFailed = countFor("FAILED");
  const backlogAvailable = backlogPending + backlogCancelled + backlogFailed;
  const remaining = Math.max(0, target - publishedToday - inFlight);

  return { target, publishedToday, inFlight, remaining, backlogAvailable, backlogPending, backlogCancelled, backlogFailed };
}

/**
 * Hands one PENDING BlogInput to the planning queue and marks it
 * PROCESSING. Shared by the submit API (start-now submissions), the
 * publish slots and the reconcile tick, so "dispatch" means exactly one
 * thing everywhere.
 *
 * Deterministic jobId: re-dispatching the same input can never enqueue a
 * second planning job for it (duplicate-blog guard).
 */
export async function dispatchBlogInput(input: {
  id: string;
  title: string;
  category: string | null;
  evidenceSummary: string | null;
  evidenceArticles: unknown;
}) {
  const planJob = await planningQueue.getJob(JOB_IDS.plan(input.id));
  if (planJob) await planJob.remove().catch(() => {});
  const outlineJob = await outlineQueue.getJob(JOB_IDS.outline(input.id));
  if (outlineJob) await outlineJob.remove().catch(() => {});
  const writeJob = await writingQueue.getJob(JOB_IDS.write(input.id));
  if (writeJob) await writeJob.remove().catch(() => {});

  await planningQueue.add(
    "plan_blog",
    {
      blogInputId: input.id,
      title: input.title,
      category: input.category ?? "General",
      evidenceSummary: input.evidenceSummary ?? "",
      evidenceSources: Array.isArray(input.evidenceArticles) ? input.evidenceArticles : undefined,
    },
    { jobId: JOB_IDS.plan(input.id) }
  );
  await prisma.blogInput.update({
    where: { id: input.id },
    data: { status: "PROCESSING", dispatchedAt: new Date(), processedAt: null, failureReason: null },
  });
}

/** The next eligible submission a slot or reconcile tick should pick up. */
export async function nextEligibleBlogInput() {
  const inputs = await prisma.blogInput.findMany({
    where: { status: { in: [...ELIGIBLE_BACKLOG_STATUSES] } },
    orderBy: { createdAt: "asc" },
  });
  return inputs.sort(compareBacklogCandidates)[0] ?? null;
}

async function nextEligibleBlogInputs(take: number) {
  const inputs = await prisma.blogInput.findMany({
    where: { status: { in: [...ELIGIBLE_BACKLOG_STATUSES] } },
    orderBy: { createdAt: "asc" },
  });
  return inputs.sort(compareBacklogCandidates).slice(0, take);
}

/**
 * Tops up today's pipeline from the submission backlog - every BlogInput
 * the user queued without starting it immediately. Called on a 30-min
 * schedule and immediately after a permanent QA failure or a publish
 * failure, so a dead article gets backfilled the same tick instead of
 * silently shrinking the day's count.
 */
export async function reconcileDailyTarget() {
  const status = await getDailyTargetStatus();
  if (status.remaining <= 0) {
    log.info("Daily target already on track, nothing to reconcile", status);
    return { ...status, dispatched: 0 };
  }

  if (status.backlogAvailable === 0) {
    log.warn(
      `Daily target short by ${status.remaining}, but no eligible blog submissions are queued - add one at /dashboard/blogs/new`,
      status
    );
    return { ...status, dispatched: 0 };
  }

  const take = Math.min(status.remaining, status.backlogAvailable);
  const inputs = await nextEligibleBlogInputs(take);

  for (const input of inputs) {
    await dispatchBlogInput(input);
  }

  log.info(`Reconciled daily target: dispatched ${inputs.length}/${status.remaining} from the eligible submission backlog`, status);
  return { ...status, dispatched: inputs.length };
}
