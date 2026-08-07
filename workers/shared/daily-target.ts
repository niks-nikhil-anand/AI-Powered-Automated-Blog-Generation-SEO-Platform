import { env } from "./env";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { planningQueue } from "./queues";
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

/**
 * publishedToday + inFlight (DRAFT/PENDING_REVIEW - the two non-terminal
 * BlogStatus values) tells us how close today already is to target without
 * double-counting: a blog that later publishes drops out of inFlight and
 * into publishedToday, a blog that permanently fails drops out of both.
 */
export async function getDailyTargetStatus(): Promise<DailyTargetStatus> {
  const target = await getSetting(DAILY_TARGET_KEY, env.DAILY_BLOG_TARGET);
  const [publishedToday, inFlight, backlogAvailable] = await Promise.all([
    prisma.blog.count({ where: { status: "PUBLISHED", updatedAt: { gte: startOfToday() } } }),
    prisma.blog.count({ where: { status: { in: ["DRAFT", "PENDING_REVIEW"] } } }),
    prisma.trend.count({ where: { status: "NEW", score: { gte: env.RESEARCH_MIN_SCORE_TO_WRITE } } }),
  ]);
  const remaining = Math.max(0, target - publishedToday - inFlight);

  return { target, publishedToday, inFlight, remaining, backlogAvailable };
}

/**
 * Tops up today's pipeline from the backlog research-worker already leaves
 * behind (every trend that clears the promotion filter gets saved as
 * status "NEW", not just the top TRENDS_TO_WRITE_PER_RUN slice - see
 * research-worker/index.ts:120-177). Called on a 30-min schedule and
 * immediately after a permanent QA failure or a publish failure, so a dead
 * article gets backfilled the same tick instead of silently shrinking the
 * day's count.
 */
export async function reconcileDailyTarget() {
  const status = await getDailyTargetStatus();
  if (status.remaining <= 0) {
    log.info("Daily target already on track, nothing to reconcile", status);
    return { ...status, dispatched: 0 };
  }

  if (status.backlogAvailable === 0) {
    log.warn(
      `Daily target short by ${status.remaining}, but no qualified backlog trends available - waiting on next research run`,
      status
    );
    return { ...status, dispatched: 0 };
  }

  const take = Math.min(status.remaining, status.backlogAvailable);
  const trends = await prisma.trend.findMany({
    where: { status: "NEW", score: { gte: env.RESEARCH_MIN_SCORE_TO_WRITE } },
    orderBy: { score: "desc" },
    take,
  });

  for (const trend of trends) {
    await planningQueue.add(
      "plan_blog",
      {
        trendId: trend.id,
        topic: trend.topic,
        category: trend.category,
        score: trend.score,
        evidenceSummary: trend.evidenceSummary,
      },
      { jobId: `plan-${trend.id}` }
    );
    await prisma.trend.update({ where: { id: trend.id }, data: { status: "PLANNED" } });
  }

  log.info(`Reconciled daily target: dispatched ${trends.length}/${status.remaining} from backlog`, status);
  return { ...status, dispatched: trends.length };
}
