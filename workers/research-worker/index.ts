import { Worker, Job } from "bullmq";
import { JOB_IDS, planningQueue, researchQueue, QUEUE_NAMES } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { withPipelineRetryPolicy } from "../shared/pipeline-retry-policy";
import { withVertexTelemetryContext } from "../shared/vertex-telemetry-context";
import { env } from "../shared/env";
import { workerOptions } from "../shared/worker-options";
import { getDailyTargetStatus, reconcileDailyTarget } from "../shared/daily-target";
import { getSetting } from "../shared/settings";
import {
  RECONCILE_SLOT_ID,
  blogSlotId,
  getPublishSlotView,
  nextOccurrenceOf,
  parseSlotTime,
  reconcilePublishSlots,
  setPublishTarget,
  slotSettingKey,
} from "../shared/publish-slots";
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
 *
 * Options:
 *  - maxDispatch: cap on topics dispatched this run (publish slots pass 1;
 *    manual/legacy runs use TRENDS_TO_WRITE_PER_RUN). The daily-remaining
 *    clamp below still applies on top.
 *  - targetPublishAt: when set, each dispatched trend gets this "hold
 *    until" timestamp recorded (workers/shared/publish-slots.ts) so
 *    quality-worker delays the publish job until the slot's publish time.
 */
export async function runResearch(options: { maxDispatch?: number; targetPublishAt?: number } = {}) {
  const attempt = await startWorkerAttempt({
    worker: "research-worker",
    input: {
      sources: getEnabledSources().map((source) => source.name),
      geo: env.GOOGLE_TRENDS_GEO,
      ...(options.maxDispatch !== undefined ? { maxDispatch: options.maxDispatch } : {}),
      ...(options.targetPublishAt !== undefined
        ? { targetPublishAt: new Date(options.targetPublishAt).toISOString() }
        : {}),
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

    const maxDispatch = Math.max(1, options.maxDispatch ?? env.TRENDS_TO_WRITE_PER_RUN);
    const topN = created
      .filter((trend) => trend.score >= env.RESEARCH_MIN_SCORE_TO_WRITE)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxDispatch);
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
      // Slot-driven runs carry the slot's target publish time down the chain
      // via Redis (keyed by trendId) - quality-worker reads it when queueing
      // the publish job and holds the blog until then.
      if (options.targetPublishAt) await setPublishTarget(trend.id, options.targetPublishAt);
      // Deterministic jobId: retrying/re-dispatching the same trend can never
      // enqueue a second planning job for it (duplicate-blog guard).
      await planningQueue.add(
        "plan_blog",
        {
          trendId: trend.id,
          topic: trend.topic,
          category: trend.category,
          score: trend.score,
          evidenceSummary: trend.description,
        },
        { jobId: JOB_IDS.plan(trend.id) }
      );
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
 * One publish slot fired: produce exactly ONE blog targeting the slot's
 * publish time. Runs research first (which also refills the backlog), then
 * falls back to the best qualified backlog trend when the run found nothing
 * new (later slots on a day mostly re-find duplicates - that's normal).
 *
 * Retry story for the slot's blog: every stage queue carries attempts: 4
 * (1 initial + 3 retries) with quota-aware backoff, QA failure re-queues
 * writing with the concrete fix list (up to 4 writing attempts), and a
 * permanent failure drops the blog out of in-flight, which makes the next
 * reconcile tick backfill the day from backlog. If the pipeline beats the
 * target time, quality-worker holds the publish job until it; if retries
 * ran past it, the blog publishes immediately on completion.
 */
async function runScheduledSlot(slotNumber: number) {
  const parsed = parseSlotTime(await getSetting<string | null>(slotSettingKey(slotNumber), null));
  if (!parsed) {
    log.warn(`Publish slot ${slotNumber} fired without a configured time - skipping (set it in Settings)`);
    return { slot: slotNumber, dispatchedCount: 0, reason: "slot_unconfigured" };
  }

  const targetPublishAt = nextOccurrenceOf(parsed.hour, parsed.minute, env.TIMEZONE, Date.now());
  log.info(
    `Publish slot ${slotNumber} fired - one blog targeting ${new Date(targetPublishAt).toISOString()} (${env.TIMEZONE})`
  );

  const output = (await runResearch({ maxDispatch: 1, targetPublishAt })) as {
    dispatchedCount?: number;
    reason?: string;
  };
  if ((output.dispatchedCount ?? 0) > 0 || output.reason === "daily_target_already_met") {
    return output;
  }

  // Research produced nothing new - backfill the slot from the backlog so
  // the day still gets its blog. The goal ceiling is respected because
  // runResearch above already returned early when the day was met.
  const { remaining } = await getDailyTargetStatus();
  if (remaining <= 0) return output;

  const backlog = await prisma.trend.findFirst({
    where: { status: "NEW", score: { gte: env.RESEARCH_MIN_SCORE_TO_WRITE } },
    orderBy: { score: "desc" },
  });
  if (!backlog) {
    log.warn(
      `Publish slot ${slotNumber}: nothing new and no qualified backlog trend - the reconcile tick retries in up to 30m`
    );
    return { ...output, reason: output.reason ?? "no_qualified_topic_available" };
  }

  await setPublishTarget(backlog.id, targetPublishAt);
  await planningQueue.add(
    "plan_blog",
    {
      trendId: backlog.id,
      topic: backlog.topic,
      category: backlog.category,
      score: backlog.score,
      evidenceSummary: backlog.evidenceSummary ?? "",
    },
    { jobId: JOB_IDS.plan(backlog.id) }
  );
  await prisma.trend.update({ where: { id: backlog.id }, data: { status: "PLANNED" } });
  log.info(
    `Publish slot ${slotNumber}: dispatched backlog trend "${backlog.topic}" (score ${Math.round(backlog.score)}) targeting ${new Date(targetPublishAt).toISOString()}`
  );
  return { ...output, dispatchedCount: 1, backlogDispatched: true };
}

/**
 * Schedule registration = the daily-target reconcile tick + the dynamic
 * publish slots (one per Daily Blog Goal, times from AppSetting). BullMQ v5+
 * upsertJobScheduler is idempotent, safe on every boot; anything else still
 * registered - including the legacy research-overnight/midday/us-daytime
 * schedulers from the pre-slot system - is removed as stale.
 */
async function registerSchedules() {
  if (!env.SCHEDULER_ENABLED) {
    log.info("SCHEDULER_ENABLED=false - skipping schedule registration");
    return;
  }

  if (env.RESEARCH_CRON) {
    log.warn(`RESEARCH_CRON="${env.RESEARCH_CRON}" is deprecated and ignored - publish slots replaced it.`);
  }

  await researchQueue.upsertJobScheduler(
    RECONCILE_SLOT_ID,
    { pattern: env.RECONCILE_CRON, tz: env.TIMEZONE },
    { name: "reconcile-daily-target", data: {} }
  );
  log.info(`Registered daily-target reconcile schedule "${env.RECONCILE_CRON}" (${env.TIMEZONE})`);

  const slotCount = await reconcilePublishSlots();
  const configured = (await getPublishSlotView()).filter((slot) => slot.configured).length;
  log.info(`Reconciled publish slots: ${configured} configured of ${slotCount} (daily blog goal)`);

  // Retire anything that isn't the reconcile tick or a currently-live slot.
  const wanted = new Set<string>([RECONCILE_SLOT_ID]);
  for (let n = 1; n <= slotCount; n += 1) {
    const parsed = parseSlotTime(await getSetting<string | null>(slotSettingKey(n), null));
    if (parsed) wanted.add(blogSlotId(n));
  }
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
    (job: Job) => withVertexTelemetryContext({
      jobId: String(job.id), queue: QUEUE_NAMES.research, worker: "research-worker", pipeline: "content", stage: "research",
    }, () => withPipelineRetryPolicy(async () => {
      if (job.name === "reconcile-daily-target") return await reconcileDailyTarget();
      if (job.name === "scheduled-slot") return await runScheduledSlot(Number(job.data.slot));
      return await runResearch();
    })),
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
