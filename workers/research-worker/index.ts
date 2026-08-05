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
import {
  failWorkerAttempt,
  passWorkerAttempt,
  type QualityGateReport,
  startWorkerAttempt,
  QualityGateError,
} from "../shared/recovery";

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
  const attempt = await startWorkerAttempt({
    worker: "research-worker",
    input: {
      sources: getEnabledSources().map((source) => source.name),
      geo: env.GOOGLE_TRENDS_GEO,
    },
  });
  const sources = getEnabledSources();
  log.info("Starting research run", {
    sources: sources.map((source) => source.name),
    geo: env.GOOGLE_TRENDS_GEO,
  });

  try {
    const sourceResults = await Promise.allSettled(
      sources.map(async (source) => ({
        source: source.name,
        signals: await (source.fetchSignals?.() ?? source.fetch?.() ?? []),
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

    // A run that finds nothing newsworthy is a normal outcome, not a fault -
    // especially on the later daily slots, where dedupe suppresses topics the
    // earlier slot already promoted. Only a genuine fault (every source down)
    // should throw and burn the retry budget.
    if (sources.length > 0 && failedSources.length === sources.length) {
      throw new Error(`All ${sources.length} research sources failed: ${failedSources.join("; ")}`);
    }

    const topN = created
      .filter((trend) => trend.score >= env.RESEARCH_MIN_SCORE_TO_WRITE)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, env.TRENDS_TO_WRITE_PER_RUN));
    const bestScore = Math.max(0, ...created.map((trend) => trend.score));

    if (topN.length === 0) {
      const output = {
        rawSignals: rawSignals.length,
        clusterCount: clusters.length,
        promotableCount: promotable.length,
        savedCount: created.length,
        dispatchedCount: 0,
        failedSources,
        reason: "no_new_topic_above_write_threshold",
      };
      log.info(
        `No new topic reached score ${env.RESEARCH_MIN_SCORE_TO_WRITE} (best: ${Math.round(bestScore)}, ${created.length} saved) - nothing dispatched`,
        output
      );
      await passWorkerAttempt({
        workflowRunId: attempt.workflow.id,
        attemptId: attempt.attempt.id,
        output,
        qualityReport: {
          stage: "research-worker",
          score: bestScore,
          passed: true,
          reasons: [`No newly-created topic reached score ${env.RESEARCH_MIN_SCORE_TO_WRITE}`],
        },
        nextStage: "stopped",
      });
      return output;
    }

    const researchGate: QualityGateReport = {
      stage: "research-worker",
      score: bestScore,
      passed: true,
      reasons: [`Selected ${topN.length} score-qualified topic(s)`],
    };

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
      `Saved ${created.length} new research candidates, dispatched ${topN.length} score>=${env.RESEARCH_MIN_SCORE_TO_WRITE} topic(s) to ${QUEUE_NAMES.planning}`
    );

    const output = {
      rawSignals: rawSignals.length,
      clusterCount: clusters.length,
      promotableCount: promotable.length,
      savedCount: created.length,
      dispatchedCount: topN.length,
      failedSources,
    };
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output,
      qualityReport: researchGate,
      nextStage: "planning-worker",
    });
    return output;
  } catch (err) {
    await failWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      error: err,
      qualityReport: err instanceof QualityGateError ? err.report : undefined,
    });
    throw err;
  }
}

/**
 * Three research slots per day. See SCHEDULING_PLAN.md for why these times -
 * each is aligned to the news cycle it is named for, in env.TIMEZONE.
 */
const RESEARCH_SLOTS = [
  { id: "research-overnight", pattern: env.RESEARCH_CRON_OVERNIGHT, label: "overnight sweep" },
  { id: "research-midday", pattern: env.RESEARCH_CRON_MIDDAY, label: "midday" },
  { id: "research-us-daytime", pattern: env.RESEARCH_CRON_US_DAYTIME, label: "US daytime" },
] as const;

async function registerSchedules() {
  if (!env.SCHEDULER_ENABLED) {
    log.info("SCHEDULER_ENABLED=false - skipping schedule registration");
    return;
  }

  if (env.RESEARCH_CRON) {
    log.warn(
      `RESEARCH_CRON="${env.RESEARCH_CRON}" is deprecated and ignored. ` +
        "Use RESEARCH_CRON_OVERNIGHT / RESEARCH_CRON_MIDDAY / RESEARCH_CRON_US_DAYTIME."
    );
  }

  // BullMQ v5+ replaced the old `{ repeat: {...} }` job option with an
  // explicit Job Scheduler API - upsert is idempotent, safe on every boot.
  for (const slot of RESEARCH_SLOTS) {
    await researchQueue.upsertJobScheduler(
      slot.id,
      { pattern: slot.pattern, tz: env.TIMEZONE },
      { name: "scheduled-research", data: { slot: slot.id } }
    );
    log.info(`Registered "${slot.label}" schedule "${slot.pattern}" (${env.TIMEZONE})`);
  }

  // Schedulers live in Redis independently of this code, so a renamed or
  // removed slot would otherwise keep firing forever. Reconcile against the
  // desired set - this is what retires the old "daily-research-schedule".
  const wanted = new Set<string>(RESEARCH_SLOTS.map((slot) => slot.id));
  const existing = await researchQueue.getJobSchedulers();
  for (const scheduler of existing) {
    if (scheduler.key && !wanted.has(scheduler.key)) {
      await researchQueue.removeJobScheduler(scheduler.key);
      log.warn(`Removed stale job scheduler "${scheduler.key}"`);
    }
  }
}

export function startResearchWorker() {
  const worker = new Worker(QUEUE_NAMES.research, () => runResearch(), {
    ...workerOptions(1),
  });

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  registerSchedules().catch((err) => log.error(`Failed to register schedules: ${err.message}`));

  log.info(`Research worker listening on "${QUEUE_NAMES.research}"`);
  return worker;
}

// Only auto-start when this file is run directly (`npm run worker:research`),
// not when imported by workers/start.ts or trigger-once.ts.
if (require.main === module) {
  startResearchWorker();
}
