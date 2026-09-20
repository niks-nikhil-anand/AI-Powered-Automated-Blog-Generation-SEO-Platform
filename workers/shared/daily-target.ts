import { env } from "./env";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { JOB_IDS, planningQueue, outlineQueue, writingQueue } from "./queues";
import { getSetting, DAILY_TARGET_KEY } from "./settings";

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
};

/** Highest-priority first, then oldest submission - the order the backlog drains in. */
const BACKLOG_ORDER = [{ priority: "desc" as const }, { createdAt: "asc" as const }];

/**
 * publishedToday + inFlight (DRAFT/PENDING_REVIEW - the two non-terminal
 * BlogStatus values) tells us how close today already is to target without
 * double-counting: a blog that later publishes drops out of inFlight and
 * into publishedToday, a blog that permanently fails drops out of both.
 *
 * backlogAvailable is the submission backlog: BlogInput rows the user
 * submitted but chose not to start immediately (status PENDING). That
 * replaced the research worker's "qualified but undispatched trend" pool.
 */
export async function getDailyTargetStatus(): Promise<DailyTargetStatus> {
  const target = await getSetting(DAILY_TARGET_KEY, env.DAILY_BLOG_TARGET);
  const [publishedToday, inFlight, backlogAvailable] = await Promise.all([
    prisma.blog.count({ where: { status: "PUBLISHED", updatedAt: { gte: startOfToday() } } }),
    prisma.blog.count({ where: { status: { in: ["DRAFT", "PENDING_REVIEW"] } } }),
    prisma.blogInput.count({ where: { status: "PENDING" } }),
  ]);
  const remaining = Math.max(0, target - publishedToday - inFlight);

  return { target, publishedToday, inFlight, remaining, backlogAvailable };
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
    data: { status: "PROCESSING", dispatchedAt: new Date(), failureReason: null },
  });
}

/** The next PENDING submission a slot or reconcile tick should pick up. */
export async function nextPendingBlogInput() {
  return prisma.blogInput.findFirst({ where: { status: "PENDING" }, orderBy: BACKLOG_ORDER });
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
      `Daily target short by ${status.remaining}, but no PENDING blog submissions are queued - add one at /dashboard/blogs/new`,
      status
    );
    return { ...status, dispatched: 0 };
  }

  const take = Math.min(status.remaining, status.backlogAvailable);
  const inputs = await prisma.blogInput.findMany({
    where: { status: "PENDING" },
    orderBy: BACKLOG_ORDER,
    take,
  });

  for (const input of inputs) {
    await dispatchBlogInput(input);
  }

  log.info(`Reconciled daily target: dispatched ${inputs.length}/${status.remaining} from the submission backlog`, status);
  return { ...status, dispatched: inputs.length };
}
