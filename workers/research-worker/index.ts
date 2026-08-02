import { Worker } from "bullmq";
import { planningQueue, researchQueue, QUEUE_NAMES } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { env } from "../shared/env";
import { workerOptions } from "../shared/worker-options";
import { getEnabledSources } from "./sources";
import { normalizeSignals } from "./pipeline/normalize";
import { dedupeSignals } from "./pipeline/dedupe";
import { scoreClusters } from "./pipeline/score";
import { promotableCandidates } from "./pipeline/promote";
import { RawSignal, ResearchCandidate } from "./types";

const log = logger.child({ worker: "research-worker" });

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function recentDuplicateCutoff(): Date {
  const d = new Date();
  d.setDate(d.getDate() - env.RESEARCH_RECENT_DUPLICATE_DAYS);
  return d;
}

function candidateDescription(candidate: ResearchCandidate): string {
  const evidenceLines = candidate.evidence
    .slice(0, 5)
    .map((signal) => {
      const source = signal.source.replace(/_/g, " ");
      return `- ${source}: ${signal.title}${signal.url ? ` (${signal.url})` : ""}`;
    })
    .join("\n");

  return [
    candidate.reason,
    `Score: ${candidate.score}`,
    `Keywords: ${candidate.keywords.join(", ")}`,
    `Evidence:\n${evidenceLines}`,
  ].join("\n\n");
}

/**
 * Worker 1: fetch Google Trends, Google News, and GitHub repository
 * momentum, normalize into a shared signal shape, dedupe, score, persist
 * promoted candidates as Trend rows, and dispatch the top N to writing.
 *
 * The full README pipeline inserts `planning_queue` and `outline_queue`
 * stages between research and writing - those aren't built yet, so the
 * writing-worker currently does title/outline/copy generation in one
 * Vertex AI call. Swap this `writingQueue.add` for `planningQueue.add`
 * once the planning/outline workers exist.
 */
export async function runResearch() {
  const sources = getEnabledSources();
  log.info("Starting research run", {
    sources: sources.map((source) => source.name),
    geo: env.GOOGLE_TRENDS_GEO,
  });

  const sourceResults = await Promise.allSettled(
    sources.map(async (source) => ({
      source: source.name,
      signals: await source.fetchSignals(),
    }))
  );

  const rawSignals: RawSignal[] = [];
  const failedSources: string[] = [];

  for (const result of sourceResults) {
    if (result.status === "fulfilled") {
      rawSignals.push(...result.value.signals);
      log.info("Fetched research signals", {
        source: result.value.source,
        count: result.value.signals.length,
      });
    } else {
      failedSources.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  const normalized = normalizeSignals(rawSignals);
  const clusters = dedupeSignals(normalized);
  const scored = scoreClusters(clusters);
  const promotable = promotableCandidates(scored);
  log.info("Research scoring complete", {
    rawSignals: rawSignals.length,
    normalized: normalized.length,
    clusters: clusters.length,
    promotable: promotable.length,
    failedSources,
  });

  const since = startOfToday();
  const duplicateCutoff = recentDuplicateCutoff();
  const created: { id: string; topic: string; category: string; description: string; score: number }[] = [];

  for (const item of promotable) {
    const alreadySavedToday = await prisma.trend.findFirst({
      where: { topic: item.title, createdAt: { gte: since } },
      select: { id: true },
    });
    if (alreadySavedToday) continue;

    const recentDuplicate = await prisma.trend.findFirst({
      where: {
        OR: [{ topic: item.title }, { topic: { contains: item.title, mode: "insensitive" } }],
        createdAt: { gte: duplicateCutoff },
      },
      select: { id: true },
    });
    if (recentDuplicate) continue;

    const trend = await prisma.trend.create({
      data: {
        topic: item.title,
        source: item.evidence.map((signal) => signal.source).join(","),
        category: item.category,
        score: item.score,
        status: "NEW",
      },
    });
    created.push({
      id: trend.id,
      topic: trend.topic,
      category: trend.category,
      description: candidateDescription(item),
      score: item.score,
    });
  }

  const topN = created.sort((a, b) => b.score - a.score).slice(0, env.TRENDS_TO_WRITE_PER_RUN);

  for (const trend of topN) {
    await planningQueue.add("plan_blog", {
      trendId: trend.id,
      topic: trend.topic,
      category: trend.category,
      score: trend.score,
      evidenceSummary: trend.description,
    });
    await prisma.trend.update({ where: { id: trend.id }, data: { status: "PLANNED" } });
  }

  log.info(
    `Saved ${created.length} new research candidates, dispatched ${topN.length} to ${QUEUE_NAMES.planning}`
  );

  return {
    rawSignals: rawSignals.length,
    clusterCount: clusters.length,
    promotableCount: promotable.length,
    savedCount: created.length,
    dispatchedCount: topN.length,
    failedSources,
  };
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
    ...workerOptions(1),
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
