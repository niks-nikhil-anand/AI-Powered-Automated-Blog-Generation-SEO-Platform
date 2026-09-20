import { Worker } from "bullmq";
import { JOB_IDS, outlineQueue, QUEUE_NAMES, type PlanningJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { withPipelineRetryPolicy } from "../shared/pipeline-retry-policy";
import { withVertexTelemetryContext } from "../shared/vertex-telemetry-context";
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
import { env } from "../shared/env";
import { logVertexRuntimeConfig } from "../shared/vertex";
import { canonicalEvidenceSources } from "../shared/evidence";
import { validatePlannedClaims, validateEvidencePackage } from "../shared/evidence-validator";
import {
  derivePlannedClaimsFromEvidence,
  normalizePlannedClaims,
  readManualPlannedClaims,
  resolveEvidenceBackedPlannedClaims,
} from "../shared/evidence-claims";
import { failBlogInput } from "../shared/blog-input";

const log = logger.child({ worker: "planning-worker" });

async function planTopic(payload: PlanningJobPayload) {
  const attempt = await startWorkerAttempt({
    worker: "planning-worker",
    blogInputId: payload.blogInputId,
    input: payload,
  });

  const blogInput = await prisma.blogInput.findUnique({ where: { id: payload.blogInputId } });
  if (!blogInput) throw new Error(`BlogInput ${payload.blogInputId} not found`);
  if (blogInput.status === "CANCELLED") {
    log.info(`Skipping "${blogInput.title}" - the submission was cancelled`, { blogInputId: blogInput.id });
    const output = { blogInputId: blogInput.id, skipped: true, reason: "submission_cancelled" };
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output,
      nextStage: "stopped",
    });
    return output;
  }

  try {
    // Sourced submissions keep the full research-era evidence contract; an
    // unsourced one is planned from the editor's specification alone (see
    // BlogInput.evidenceArticles in prisma/schema.prisma).
    const evidenceSources = canonicalEvidenceSources(blogInput.evidenceArticles);
    const sourced = evidenceSources.length > 0;
    if (sourced && env.EVIDENCE_VALIDATION_ENABLED) {
      const evidenceGate = validateEvidencePackage(evidenceSources);
      if (!evidenceGate.ok) {
        throw new QualityGateError({ stage: "evidence-validator", score: 0, passed: false, reasons: evidenceGate.diagnostics });
      }
    }

    const startedAt = Date.now();
    const { plan, usage, model } = await generateContentPlan(
      {
        title: blogInput.title,
        category: blogInput.category ?? payload.category ?? "General",
        audience: blogInput.audience,
        searchIntent: blogInput.searchIntent,
        tone: blogInput.tone,
        contentLength: blogInput.contentLength,
        focusKeyword: blogInput.focusKeyword,
        keywords: blogInput.keywords,
        secondaryKeywords: blogInput.secondaryKeywords,
      },
      blogInput.evidenceSummary ?? payload.evidenceSummary ?? "",
      evidenceSources
    );
    let plannedClaims = plan.plannedClaims;
    if (sourced) {
      if (env.EVIDENCE_VALIDATION_ENABLED) {
        const resolvedClaims = resolveEvidenceBackedPlannedClaims({
          modelClaims: plan.plannedClaims,
          manualClaims: readManualPlannedClaims(blogInput.specs),
          evidenceSources,
        });
        plannedClaims = resolvedClaims.claims;
        const claimGate = validatePlannedClaims(plannedClaims, evidenceSources);
        if (!claimGate.ok) {
          throw new QualityGateError({
            stage: "evidence-validator",
            score: 0,
            passed: false,
            reasons: [...resolvedClaims.diagnostics, ...claimGate.diagnostics],
          });
        }
        log.info("Planning evidence contract passed", {
          blogInputId: payload.blogInputId,
          claimSource: resolvedClaims.source,
          claimResolutionDiagnostics: resolvedClaims.diagnostics,
          plannedClaims: plannedClaims.length,
          claimsWithEvidence: claimGate.supportedClaims.length,
          researchSufficiencyScore: claimGate.researchSufficiencyScore,
        });
      } else {
        const modelClaims = normalizePlannedClaims(plan.plannedClaims, evidenceSources);
        const manualClaims = normalizePlannedClaims(readManualPlannedClaims(blogInput.specs), evidenceSources);
        plannedClaims = modelClaims.length > 0 ? modelClaims : manualClaims.length > 0 ? manualClaims : derivePlannedClaimsFromEvidence(evidenceSources);
        log.info("Planning evidence validation disabled - sources are context only", {
          blogInputId: payload.blogInputId,
          plannedClaims: plannedClaims.length,
          evidenceSources: evidenceSources.length,
        });
      }
    } else {
      log.info("Planning ran in unsourced mode - no evidence contract to enforce", {
        blogInputId: payload.blogInputId,
      });
    }
    const plannedClaimsJson = JSON.parse(JSON.stringify(plannedClaims));
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
      where: { blogInputId: payload.blogInputId },
      create: {
        blogInputId: payload.blogInputId,
        searchIntent: plan.searchIntent,
        audience: plan.audience,
        angle: plan.angle,
        primaryKeyword: plan.primaryKeyword,
        secondaryKeywords: plan.secondaryKeywords,
        competitorNotes: plan.competitorNotes,
        internalNotes: plan.internalNotes,
        plannedClaims: plannedClaimsJson,
      },
      update: {
        searchIntent: plan.searchIntent,
        audience: plan.audience,
        angle: plan.angle,
        primaryKeyword: plan.primaryKeyword,
        secondaryKeywords: plan.secondaryKeywords,
        competitorNotes: plan.competitorNotes,
        internalNotes: plan.internalNotes,
        plannedClaims: plannedClaimsJson,
      },
    });

    await recordAIUsage({
      worker: "planning-worker",
      model,
      usage,
      latencyMs,
      blogInputId: payload.blogInputId,
    });

    // Deterministic jobId: a retried planning job can never enqueue a second
    // outline job for the same submission (duplicate-spend guard).
    await outlineQueue.add(
      "outline_blog",
      { blogInputId: payload.blogInputId, planId: saved.id },
      { jobId: JOB_IDS.outline(payload.blogInputId) }
    );
    await prisma.blogInput.update({ where: { id: payload.blogInputId }, data: { status: "PROCESSING" } });
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output: { blogInputId: blogInput.id, planId: saved.id },
      qualityReport: gate,
      nextStage: "outline-worker",
      blogInputId: blogInput.id,
    });

    log.info(`Content plan saved for "${blogInput.title}"`, { blogInputId: blogInput.id, planId: saved.id });
    return { blogInputId: blogInput.id, planId: saved.id };
  } catch (err) {
    await failWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      error: err,
      qualityReport: err instanceof QualityGateError ? err.report : undefined,
    });
    await failBlogInput(payload.blogInputId, err);
    throw err;
  }
}

export function startPlanningWorker() {
  const worker = new Worker(
    QUEUE_NAMES.planning,
    async (job) => withVertexTelemetryContext(
      { jobId: String(job.id), queue: QUEUE_NAMES.planning, worker: "planning-worker", pipeline: "content", stage: "planning" },
      () => withPipelineRetryPolicy(() => planTopic(job.data as PlanningJobPayload))
    ),
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
