import { Worker } from "bullmq";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { env } from "../shared/env";
import { QUEUE_NAMES, type OutlineJobPayload, writingQueue } from "../shared/queues";
import { generateContentOutline } from "./vertex";
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

const log = logger.child({ worker: "outline-worker" });

async function outlineTopic(payload: OutlineJobPayload) {
  const attempt = await startWorkerAttempt({
    worker: "outline-worker",
    trendId: payload.trendId,
    input: payload,
  });
  const plan = await prisma.contentPlan.findUnique({
    where: { id: payload.planId },
    include: { trend: true },
  });
  if (!plan) throw new Error(`ContentPlan ${payload.planId} not found`);
  // manuallyApproved lets a human-approved below-threshold trend (see
  // app/api/trends/[id]/approve) survive this gate the same way
  // planning-worker's identical check does.
  if (plan.trend.score < env.RESEARCH_MIN_SCORE_TO_WRITE && !plan.trend.manuallyApproved) {
    log.info(`Skipping writing for "${plan.trend.topic}" because score ${Math.round(plan.trend.score)} is below ${env.RESEARCH_MIN_SCORE_TO_WRITE}`, {
      trendId: plan.trend.id,
      score: plan.trend.score,
    });
    const output = { trendId: plan.trend.id, skipped: true, reason: "score_below_write_threshold" };
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
    const { outline, usage, model } = await generateContentOutline(plan.trend.topic, plan.trend.category, plan);
    const latencyMs = Date.now() - startedAt;
    const sections = Array.isArray(outline.sections) ? outline.sections : [];
    const faqs = Array.isArray(outline.faqs) ? outline.faqs : [];
    const gate = scoreRequiredFields("outline-worker", [
      { label: "title", ok: Boolean(outline.title) },
      { label: "slug", ok: Boolean(outline.slug) },
      { label: "meta title", ok: Boolean(outline.metaTitle) },
      { label: "meta description", ok: Boolean(outline.metaDescription) },
      { label: "H2/H3 sections", ok: sections.length >= 6 },
      { label: "FAQs", ok: faqs.length >= 3 },
    ]);
    assertGate(gate);

    const saved = await prisma.contentOutline.upsert({
      where: { trendId: payload.trendId },
      create: {
        trendId: payload.trendId,
        planId: plan.id,
        title: outline.title,
        slug: outline.slug,
        metaTitle: outline.metaTitle,
        metaDescription: outline.metaDescription,
        sections: sections,
        faqs: faqs,
      },
      update: {
        title: outline.title,
        slug: outline.slug,
        metaTitle: outline.metaTitle,
        metaDescription: outline.metaDescription,
        sections: sections,
        faqs: faqs,
      },
    });

    await recordAIUsage({
      worker: "outline-worker",
      model,
      usage,
      latencyMs,
      trendId: payload.trendId,
    });

    await writingQueue.add("write_blog", {
      trendId: payload.trendId,
      outlineId: saved.id,
      topic: saved.title,
      description: plan.angle,
    });
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output: { trendId: plan.trend.id, outlineId: saved.id },
      qualityReport: gate,
      nextStage: "writing-worker",
    });

    log.info(`Content outline saved for "${plan.trend.topic}"`, {
      trendId: plan.trend.id,
      outlineId: saved.id,
    });
    return { trendId: plan.trend.id, outlineId: saved.id };
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

export function startOutlineWorker() {
  const worker = new Worker(
    QUEUE_NAMES.outline,
    async (job) => outlineTopic(job.data as OutlineJobPayload),
    workerOptions(1)
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  log.info(`Outline worker listening on "${QUEUE_NAMES.outline}"`);
  return worker;
}

if (require.main === module) {
  startOutlineWorker();
}
