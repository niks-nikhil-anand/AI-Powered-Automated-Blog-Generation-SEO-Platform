import { Worker, Job } from "bullmq";
import { planningQueue, researchQueue, QUEUE_NAMES } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { env } from "../shared/env";
import { workerOptions } from "../shared/worker-options";
import { getDailyTargetStatus, reconcileDailyTarget } from "../shared/daily-target";
import { getSetting } from "../shared/settings";
import {
  RESEARCH_SLOTS,
  RECONCILE_SLOT_ID,
  envPatternForSlot,
  isValidCronPattern,
  scheduleSettingKey,
} from "../shared/research-slots";
import { getEnabledSources } from "./sources";
import { normalizeSignals } from "./pipeline/normalize";
import { dedupeSignals } from "./pipeline/dedupe";
import { semanticEnrich } from "./pipeline/semantic";
import { scoreClusters } from "./pipeline/score";
import { promotableCandidates } from "./pipeline/promote";
import { fetchEvidenceArticles } from "./pipeline/evidence";
import { runResearchEngine } from "./pipeline/engine";
import { RawSignal, ResearchCandidate } from "./types";
import {
  failWorkerAttempt,
  passWorkerAttempt,
  type QualityGateReport,
  startWorkerAttempt,
  QualityGateError,
} from "../shared/recovery";
import { logVertexRuntimeConfig } from "../shared/vertex";

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
    // Research-engine branch (docs/RESEARCH_ENGINE_UPGRADE.md). OFF by default;
    // when ON, the novelty-driven engine runs the full upgraded pipeline and the
    // legacy path below is skipped entirely. The audit wrapper (startWorkerAttempt
    // / passWorkerAttempt / failWorkerAttempt) is identical either way.
    if (env.RESEARCH_ENGINE_ENABLED) {
      const engineOutput = await runResearchEngine(attempt.workflow.id);
      await passWorkerAttempt({
        workflowRunId: attempt.workflow.id,
        attemptId: attempt.attempt.id,
        output: engineOutput.report,
        qualityReport: {
          stage: "research-worker",
          score: engineOutput.report.avgFinalScore,
          passed: true,
          reasons: [engineOutput.report.outcomeReason],
        },
        nextStage: engineOutput.dispatchedCount > 0 ? "planning-worker" : "stopped",
      });
      return engineOutput;
    }

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
    const enriched = await semanticEnrich(clusters);
    const scored = scoreClusters(enriched);
    const promotable = promotableCandidates(scored);
    log.info("Research scoring complete", {
      rawSignals: rawSignals.length,
      normalized: normalized.length,
      clustersAfterHeuristicDedupe: clusters.length,
      clustersAfterSemanticDedupe: enriched.length,
      promotable: promotable.length,
      failedSources,
    });

    const since = startOfToday();
    const duplicateCutoff = recentDuplicateCutoff();
    const created: { id: string; topic: string; category: string; description: string; score: number }[] = [];
    let duplicateSkippedCount = 0;

    for (const item of promotable) {
      const alreadySavedToday = await prisma.trend.findFirst({
        where: { topic: item.title, createdAt: { gte: since } },
        select: { id: true },
      });
      if (alreadySavedToday) {
        duplicateSkippedCount += 1;
        continue;
      }

      const recentDuplicate = await prisma.trend.findFirst({
        where: {
          OR: [{ topic: item.title }, { topic: { contains: item.title, mode: "insensitive" } }],
          createdAt: { gte: duplicateCutoff },
        },
        select: { id: true },
      });
      if (recentDuplicate) {
        duplicateSkippedCount += 1;
        continue;
      }

      const description = candidateDescription(item);
      // Full-text evidence ingestion (Task 1): fetch the actual articles
      // behind the top evidence URLs so downstream stages ground on real
      // source text. Runs only for promotable candidates (post-dedupe) and
      // never throws - any failure leaves evidenceArticles unset and every
      // consumer falls back to the titles-only evidenceSummary path.
      const evidenceArticles = env.EVIDENCE_FETCH_ENABLED ? await fetchEvidenceArticles(item) : [];
      const trend = await prisma.trend.create({
        data: {
          topic: item.title,
          source: item.evidence.map((signal) => signal.source).join(","),
          category: item.category,
          score: item.score,
          status: "NEW",
          // Persisted for the dashboard trend-detail modal's signal-breakdown
          // bars - the per-dimension scores used to live only in the run log.
          scoreBreakdown: item.scoreBreakdown,
          ...(evidenceArticles.length > 0 ? { evidenceArticles } : {}),
          // Persisted so later stages (writing-worker's citations, quality-worker's
          // fact-check) can still reach the original evidence - previously this
          // only lived in the one-time planningQueue job payload below and was
          // gone by the time quality-worker ran. See IMPLEMENTATION_PLAN.md Phase 2.1.
          evidenceSummary: description,
        },
      });
      created.push({
        id: trend.id,
        topic: trend.topic,
        category: trend.category,
        description,
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
    // Best score among everything this run *found* (promotable), not just
    // what got newly saved (created). `created` is empty whenever every
    // promotable candidate turned out to be a duplicate of something already
    // saved minutes or days earlier - that used to report "best: 0" and read
    // as "nothing scored well this run" when the real story was "nothing NEW
    // was found." duplicateSkippedCount below makes that distinction explicit
    // instead of silently folding it into the same number.
    const bestScore = Math.max(0, ...promotable.map((item) => item.score));

    if (topN.length === 0) {
      const output = {
        rawSignals: rawSignals.length,
        clusterCount: clusters.length,
        promotableCount: promotable.length,
        savedCount: created.length,
        duplicateSkippedCount,
        dispatchedCount: 0,
        failedSources,
        reason: "no_new_topic_above_write_threshold",
      };
      log.info(
        duplicateSkippedCount > 0
          ? `No new topic dispatched (best candidate scored ${Math.round(bestScore)}; ${created.length} newly saved, ${duplicateSkippedCount}/${promotable.length} already saved today or recently)`
          : `No new topic reached score ${env.RESEARCH_MIN_SCORE_TO_WRITE} (best: ${Math.round(bestScore)}, ${created.length} saved) - nothing dispatched`,
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
          reasons: [
            duplicateSkippedCount > 0
              ? `${duplicateSkippedCount}/${promotable.length} candidate(s) were already saved today or recently; best candidate scored ${Math.round(bestScore)}`
              : `No newly-created topic reached score ${env.RESEARCH_MIN_SCORE_TO_WRITE}`,
          ],
        },
        nextStage: "stopped",
      });
      return output;
    }

    // Daily Target Controller coupling: the dashboard goal is a ceiling as
    // well as a floor. Previously a run dispatched TRENDS_TO_WRITE_PER_RUN
    // topics regardless of the goal, so "3/day" could actually publish up to
    // 9; now dispatch is capped at the day's remaining need. Anything above
    // the cap simply stays status "NEW" - the reconcile tick
    // (workers/shared/daily-target.ts) picks it up as backlog later the same
    // day, which is exactly what the backlog is for.
    const { remaining: dailyRemaining, target: dailyTarget } = await getDailyTargetStatus();
    const dispatchable = topN.slice(0, Math.max(0, dailyRemaining));
    const goalClampedCount = topN.length - dispatchable.length;

    if (dispatchable.length === 0) {
      const output = {
        rawSignals: rawSignals.length,
        clusterCount: clusters.length,
        promotableCount: promotable.length,
        savedCount: created.length,
        duplicateSkippedCount,
        dispatchedCount: 0,
        goalClampedCount,
        failedSources,
        reason: "daily_target_already_met",
      };
      log.info(
        `Daily target ${dailyTarget} already met - ${topN.length} qualified topic(s) stay in backlog for later reconcile ticks`,
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
          reasons: [
            `Daily target ${dailyTarget} already met; ${topN.length} qualified topic(s) saved as backlog`,
          ],
        },
        nextStage: "stopped",
      });
      return output;
    }

    const researchGate: QualityGateReport = {
      stage: "research-worker",
      score: bestScore,
      passed: true,
      reasons: [
        `Selected ${dispatchable.length} score-qualified topic(s)` +
          (goalClampedCount > 0 ? ` (${goalClampedCount} held as backlog - daily target ${dailyTarget} needs ${dailyRemaining} more)` : ""),
      ],
    };

    for (const trend of dispatchable) {
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
      `Saved ${created.length} new research candidates, dispatched ${dispatchable.length} score>=${env.RESEARCH_MIN_SCORE_TO_WRITE} topic(s) to ${QUEUE_NAMES.planning}` +
        (goalClampedCount > 0 ? ` (${goalClampedCount} clamped to backlog by daily target)` : "")
    );

    const output = {
      rawSignals: rawSignals.length,
      clusterCount: clusters.length,
      promotableCount: promotable.length,
      savedCount: created.length,
      dispatchedCount: dispatchable.length,
      goalClampedCount,
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
 * Three research slots per day (metadata in workers/shared/research-slots.ts)
 * plus the daily-target reconcile tick. Each slot's pattern comes from its
 * RESEARCH_CRON_* env var UNLESS the dashboard has an AppSetting override -
 * see below.
 */
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
  //
  // Dashboard edits (PATCH /api/pipeline/schedules/[id]) are persisted to
  // AppSetting as `schedule:<slotId>`; without reading them back here, every
  // boot would silently re-upsert the env defaults and revert the user's
  // edit. Precedence: AppSetting override > RESEARCH_CRON_* env var. A
  // corrupt stored pattern fails isValidCronPattern and falls back to env
  // rather than crashing BullMQ's cron parser.
  for (const slot of RESEARCH_SLOTS) {
    const stored = await getSetting<string | null>(scheduleSettingKey(slot.id), null);
    const pattern = isValidCronPattern(stored) ? stored : envPatternForSlot(slot.id);
    await researchQueue.upsertJobScheduler(
      slot.id,
      { pattern, tz: env.TIMEZONE },
      { name: "scheduled-research", data: { slot: slot.id } }
    );
    log.info(
      `Registered "${slot.label}" schedule "${pattern}" (${env.TIMEZONE})${isValidCronPattern(stored) ? " [dashboard override]" : ""}`
    );
  }

  // Daily Target Controller safety net - reuses this queue rather than
  // standing up a new one, distinguished from the research slots above by
  // job name (see startResearchWorker's job router below).
  await researchQueue.upsertJobScheduler(
    RECONCILE_SLOT_ID,
    { pattern: env.RECONCILE_CRON, tz: env.TIMEZONE },
    { name: "reconcile-daily-target", data: {} }
  );
  log.info(`Registered daily-target reconcile schedule "${env.RECONCILE_CRON}" (${env.TIMEZONE})`);

  // Schedulers live in Redis independently of this code, so a renamed or
  // removed slot would otherwise keep firing forever. Reconcile against the
  // desired set - this is what retires the old "daily-research-schedule".
  const wanted = new Set<string>([...RESEARCH_SLOTS.map((slot) => slot.id), RECONCILE_SLOT_ID]);
  const existing = await researchQueue.getJobSchedulers();
  for (const scheduler of existing) {
    if (scheduler.key && !wanted.has(scheduler.key)) {
      await researchQueue.removeJobScheduler(scheduler.key);
      log.warn(`Removed stale job scheduler "${scheduler.key}"`);
    }
  }
}

export function startResearchWorker() {
  const worker = new Worker(
    QUEUE_NAMES.research,
    (job: Job) => (job.name === "reconcile-daily-target" ? reconcileDailyTarget() : runResearch()),
    { ...workerOptions(1) }
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  registerSchedules().catch((err) => log.error(`Failed to register schedules: ${err.message}`));

  logVertexRuntimeConfig(log);
  log.info(`Research worker listening on "${QUEUE_NAMES.research}"`);
  return worker;
}

// Only auto-start when this file is run directly (`npm run worker:research`),
// not when imported by workers/start.ts or trigger-once.ts.
if (require.main === module) {
  startResearchWorker();
}
