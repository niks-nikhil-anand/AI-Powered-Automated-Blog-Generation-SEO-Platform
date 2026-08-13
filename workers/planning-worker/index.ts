import { Worker } from "bullmq";
import { JOB_IDS, outlineQueue, QUEUE_NAMES, type PlanningJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { env } from "../shared/env";
import { generateContentPlan } from "./vertex";
import { workerOptions } from "../shared/worker-options";
import { recordAIUsage } from "../shared/pricing";
import {
  assertGate,
  failWorkerAttempt,
  passWorkerAttempt,
  scoreRequiredFields,
  startWorkerAttempt,
  QualityGateError,
} from "../shared/recovery";
import { logVertexRuntimeConfig } from "../shared/vertex";

const log = logger.child({ worker: "planning-worker" });

async function planTopic(payload: PlanningJobPayload) {
  const attempt = await startWorkerAttempt({
    worker: "planning-worker",
    trendId: payload.trendId,
    input: payload,
  });

  const trend = await prisma.trend.findUnique({ where: { id: payload.trendId } });
  if (!trend) throw new Error(`Trend ${payload.trendId} not found`);
  // manuallyApproved lets a human-approved below-threshold trend (see
  // app/api/trends/[id]/approve) survive this gate instead of being
  // silently re-rejected right after the dashboard said "queued successfully."
  if (trend.score < env.RESEARCH_MIN_SCORE_TO_WRITE && !trend.manuallyApproved) {
    log.info(`Skipping "${trend.topic}" because score ${Math.round(trend.score)} is below ${env.RESEARCH_MIN_SCORE_TO_WRITE}`, {
      trendId: trend.id,
      score: trend.score,
    });
    const output = { trendId: trend.id, skipped: true, reason: "score_below_write_threshold" };
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output,
      nextStage: "stopped",
    });
    return output;
  }

  try {
    const startedAt = Date.now();
    const { plan, usage, model } = await generateContentPlan(
      payload.topic,
      payload.category,
      payload.score,
      payload.evidenceSummary
    );
    const latencyMs = Date.now() - startedAt;
    const gate = scoreRequiredFields("planning-worker", [
      { label: "search intent", ok: Boolean(plan.searchIntent) },
      { label: "audience", ok: Boolean(plan.audience) },
      { label: "angle", ok: Boolean(plan.angle) },
      { label: "primary keyword", ok: Boolean(plan.primaryKeyword) },
      { label: "secondary keywords", ok: Array.isArray(plan.secondaryKeywords) && plan.secondaryKeywords.length > 0 },
      { label: "competitor notes", ok: Array.isArray(plan.competitorNotes) && plan.competitorNotes.length > 0 },
    ]);
    assertGate(gate);

    const saved = await prisma.contentPlan.upsert({
      where: { trendId: payload.trendId },
      create: {
        trendId: payload.trendId,
        searchIntent: plan.searchIntent,
        audience: plan.audience,
        angle: plan.angle,
        primaryKeyword: plan.primaryKeyword,
        secondaryKeywords: plan.secondaryKeywords,
        competitorNotes: plan.competitorNotes,
        internalNotes: plan.internalNotes,
      },
      update: {
        searchIntent: plan.searchIntent,
        audience: plan.audience,
        angle: plan.angle,
        primaryKeyword: plan.primaryKeyword,
        secondaryKeywords: plan.secondaryKeywords,
        competitorNotes: plan.competitorNotes,
        internalNotes: plan.internalNotes,
      },
    });

    await recordAIUsage({
      worker: "planning-worker",
      model,
      usage,
      latencyMs,
      trendId: payload.trendId,
    });

    // Deterministic jobId: a retried planning job can never enqueue a second
    // outline job for the same trend (duplicate-spend guard).
    await outlineQueue.add(
      "outline_blog",
      { trendId: payload.trendId, planId: saved.id },
      { jobId: JOB_IDS.outline(payload.trendId) }
    );
    await prisma.trend.update({ where: { id: payload.trendId }, data: { status: "PLANNED" } });
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output: { trendId: trend.id, planId: saved.id },
      qualityReport: gate,
      nextStage: "outline-worker",
    });

    log.info(`Content plan saved for "${trend.topic}"`, { trendId: trend.id, planId: saved.id });
    return { trendId: trend.id, planId: saved.id };
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

export function startPlanningWorker() {
  const worker = new Worker(
    QUEUE_NAMES.planning,
    async (job) => planTopic(job.data as PlanningJobPayload),
    workerOptions(1)
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  logVertexRuntimeConfig(log);
  log.info(`Planning worker listening on "${QUEUE_NAMES.planning}"`);
  return worker;
}

if (require.main === module) {
  startPlanningWorker();
}
