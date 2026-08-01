import { Worker } from "bullmq";
import { createRedisConnection } from "../shared/redis";
import { researchQueue, writingQueue, QUEUE_NAMES } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { fetchGoogleTrends, scoreAndDedupe } from "./google-trends";
import { logger } from "../shared/logger";
import { env } from "../shared/env";

const log = logger.child({ worker: "research-worker" });

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Worker 1 (MVP scope): fetch Google Trends, de-dupe against what we
 * already saved today, persist new Trend rows, and dispatch the top N
 * scoring topics straight to `writing_queue`.
 *
 * The full README pipeline inserts `planning_queue` and `outline_queue`
 * stages between research and writing - those aren't built yet, so the
 * writing-worker currently does title/outline/copy generation in one
 * Vertex AI call. Swap this `writingQueue.add` for `planningQueue.add`
 * once the planning/outline workers exist.
 */
export async function runResearch() {
  log.info("Fetching Google Trends", { geo: env.GOOGLE_TRENDS_GEO });

  const raw = await fetchGoogleTrends();
  const scored = scoreAndDedupe(raw);
  log.info(`Fetched ${raw.length} raw trends, ${scored.length} after de-dup`);

  const since = startOfToday();
  const created: { id: string; topic: string; description: string; score: number }[] = [];

  for (const item of scored) {
    const alreadySavedToday = await prisma.trend.findFirst({
      where: { topic: item.topic, source: "google-trends", createdAt: { gte: since } },
      select: { id: true },
    });
    if (alreadySavedToday) continue;

    const trend = await prisma.trend.create({
      data: {
        topic: item.topic,
        source: "google-trends",
        category: "General",
        score: item.score,
        status: "NEW",
      },
    });
    created.push({ id: trend.id, topic: trend.topic, description: item.description, score: item.score });
  }

  const topN = created.sort((a, b) => b.score - a.score).slice(0, env.TRENDS_TO_WRITE_PER_RUN);

  for (const trend of topN) {
    await writingQueue.add("write_blog", {
      trendId: trend.id,
      topic: trend.topic,
      description: trend.description,
    });
    await prisma.trend.update({ where: { id: trend.id }, data: { status: "PLANNED" } });
  }

  log.info(
    `Saved ${created.length} new trends, dispatched ${topN.length} to ${QUEUE_NAMES.writing}`
  );

  return { savedCount: created.length, dispatchedCount: topN.length };
}

async function registerDailySchedule() {
  // BullMQ v5+ replaced the old `{ repeat: {...} }` job option with an
  // explicit Job Scheduler API - upsert is idempotent, safe to call on
  // every worker boot.
  await researchQueue.upsertJobScheduler(
    "daily-research-schedule",
    { pattern: env.RESEARCH_CRON, tz: env.TIMEZONE },
    { name: "daily-research" }
  );
  log.info(`Registered daily schedule "${env.RESEARCH_CRON}" (timezone: ${env.TIMEZONE})`);
}

export function startResearchWorker() {
  const worker = new Worker(QUEUE_NAMES.research, () => runResearch(), {
    connection: createRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  registerDailySchedule().catch((err) => log.error(`Failed to register schedule: ${err.message}`));

  log.info(`Research worker listening on "${QUEUE_NAMES.research}"`);
  return worker;
}

// Only auto-start when this file is run directly (`npm run worker:research`),
// not when imported by workers/start.ts or trigger-once.ts.
if (require.main === module) {
  startResearchWorker();
}
