import { Worker } from "bullmq";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { withPipelineRetryPolicy } from "../shared/pipeline-retry-policy";
import { withVertexTelemetryContext } from "../shared/vertex-telemetry-context";
import { JOB_IDS, QUEUE_NAMES, type OutlineJobPayload, writingQueue } from "../shared/queues";
import { generateContentOutline } from "./vertex";
import { outlineFromUserInput, parseUserOutline } from "./user-outline";
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
import { logVertexRuntimeConfig, slugify } from "../shared/vertex";
import { canonicalEvidenceSources } from "../shared/evidence";
import { validatePlannedClaims } from "../shared/evidence-validator";
import { normalizePlannedClaims } from "../shared/evidence-claims";
import { failBlogInput } from "../shared/blog-input";

const log = logger.child({ worker: "outline-worker" });

async function outlineTopic(payload: OutlineJobPayload) {
  const attempt = await startWorkerAttempt({
    worker: "outline-worker",
    blogInputId: payload.blogInputId,
    input: payload,
  });
  const plan = await prisma.contentPlan.findUnique({
    where: { id: payload.planId },
    include: { blogInput: true },
  });
  if (!plan) throw new Error(`ContentPlan ${payload.planId} not found`);
  const blogInput = plan.blogInput;
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
    const evidenceSources = canonicalEvidenceSources(blogInput.evidenceArticles);
    const sourced = evidenceSources.length > 0;

    // An editor-supplied outline is a decision, not a suggestion: when one
    // parses, it is used verbatim and no Vertex call is made at all. The
    // writing worker still merges it into the mandatory section skeleton, so
    // a short hand-written outline can't produce a structurally thin article.
    const userOutline = parseUserOutline(blogInput.outlineJson);
    const startedAt = Date.now();
    const generated = userOutline
      ? {
          outline: outlineFromUserInput(userOutline, {
            title: blogInput.title,
            metaTitle: blogInput.metaTitle,
            metaDescription: blogInput.metaDescription,
            angle: plan.angle,
            slug: blogInput.slug || slugify(blogInput.title),
          }),
          usage: { promptTokens: 0, completionTokens: 0 },
          model: "user-supplied",
        }
      : await generateContentOutline(blogInput.title, blogInput.category ?? "General", plan, {
          metaTitle: blogInput.metaTitle,
          metaDescription: blogInput.metaDescription,
          contentLength: blogInput.contentLength,
          sourced,
        });
    const { outline, usage, model } = generated;
    const latencyMs = Date.now() - startedAt;
    let sections = Array.isArray(outline.sections) ? outline.sections : [];
    const faqs = Array.isArray(outline.faqs) ? outline.faqs : [];
    const plannedClaims = normalizePlannedClaims((plan as { plannedClaims?: unknown }).plannedClaims, evidenceSources);
    let outlineClaims = sections.flatMap((section) => Array.isArray((section as { claims?: unknown }).claims) ? (section as { claims: unknown[] }).claims : []);
    if (sourced && outlineClaims.length === 0 && plannedClaims.length > 0) {
      sections = sections.map((section, index) => {
        const claim = plannedClaims[index % plannedClaims.length];
        return {
          ...section,
          claims: [{ text: claim.claim, evidenceSourceIds: claim.evidenceSourceIds }],
        };
      });
      outlineClaims = sections.flatMap((section) => Array.isArray((section as { claims?: unknown }).claims) ? (section as { claims: unknown[] }).claims : []);
    }

    // Sourced submissions keep the full evidence contract; an unsourced one
    // has nothing to validate claims against, so the gate is skipped rather
    // than failed (see BlogInput.evidenceArticles in prisma/schema.prisma).
    if (sourced && env.EVIDENCE_VALIDATION_ENABLED) {
      // Outline claims use the presentation-facing `text` field; the shared
      // evidence validator uses `claim`. Normalize at this boundary so the
      // semantic evidence check is applied to the actual outline claims.
      const outlineClaimsForValidation = outlineClaims.map((claim) => {
        const value = claim as { text?: unknown; evidenceSourceIds?: unknown };
        return { claim: value.text, evidenceSourceIds: value.evidenceSourceIds, supportLevel: "direct" as const };
      });
      const outlineGate = validatePlannedClaims(outlineClaimsForValidation, evidenceSources);
      const plannedGate = validatePlannedClaims(plannedClaims, evidenceSources);
      if (!plannedGate.ok || !outlineGate.ok) {
        throw new QualityGateError({ stage: "outline-validator", score: 0, passed: false, reasons: [...plannedGate.diagnostics, ...outlineGate.diagnostics, "OUTLINE_REJECTED: outline claims must be directly supported by evidence"] });
      }
    }

    // A hand-written outline sets its own bar: the editor decided how many
    // sections this article needs, and the writing worker's mandatory
    // skeleton guarantees the structural minimum regardless.
    const minSections = userOutline ? 1 : 6;
    const minFaqs = userOutline ? 0 : 3;
    const gate = scoreRequiredFields("outline-worker", [
      { label: "title", ok: Boolean(outline.title) },
      { label: "slug", ok: Boolean(outline.slug) },
      { label: "meta title", ok: Boolean(outline.metaTitle) },
      { label: "meta description", ok: Boolean(outline.metaDescription) },
      { label: "H2/H3 sections", ok: sections.length >= minSections },
      { label: "FAQs", ok: faqs.length >= minFaqs },
      { label: "claim-level evidence metadata", ok: !sourced || !env.EVIDENCE_VALIDATION_ENABLED || outlineClaims.length > 0 },
    ]);
    assertGate(gate);

    const saved = await prisma.contentOutline.upsert({
      where: { blogInputId: payload.blogInputId },
      create: {
        blogInputId: payload.blogInputId,
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
      blogInputId: payload.blogInputId,
    });

    // Every claim that exists must carry evidence - an unsourced submission
    // legitimately has none, but a claim asserting a source that isn't there
    // must never reach the writer.
    for (const claim of outlineClaims) {
      const value = claim as { text?: unknown; evidenceSourceIds?: unknown };
      if (!Array.isArray(value.evidenceSourceIds) || value.evidenceSourceIds.length === 0) {
        throw new Error(`WRITING_ENQUEUE_BLOCKED: claim has no evidence: ${String(value.text ?? "")}`);
      }
    }

    // Deterministic jobId: a retried outline job can never enqueue a second
    // fresh write for the same submission. QA requeues use their own
    // epoch-keyed IDs (JOB_IDS.writeQaRetry), so this guard never blocks
    // recovery.
    await writingQueue.add(
      "write_blog",
      {
        blogInputId: payload.blogInputId,
        outlineId: saved.id,
        topic: saved.title,
        description: plan.angle,
      },
      { jobId: JOB_IDS.write(payload.blogInputId) }
    );
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output: { blogInputId: blogInput.id, outlineId: saved.id, source: userOutline ? "user-supplied" : "generated" },
      qualityReport: gate,
      nextStage: "writing-worker",
      blogInputId: blogInput.id,
    });

    log.info(`Content outline saved for "${blogInput.title}"`, {
      blogInputId: blogInput.id,
      outlineId: saved.id,
      source: userOutline ? "user-supplied" : "generated",
    });
    return { blogInputId: blogInput.id, outlineId: saved.id };
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

export function startOutlineWorker() {
  const worker = new Worker(
    QUEUE_NAMES.outline,
    async (job) => withVertexTelemetryContext(
      { jobId: String(job.id), queue: QUEUE_NAMES.outline, worker: "outline-worker", pipeline: "content", stage: "outline" },
      () => withPipelineRetryPolicy(() => outlineTopic(job.data as OutlineJobPayload))
    ),
    workerOptions(1)
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  logVertexRuntimeConfig(log);
  log.info(`Outline worker listening on "${QUEUE_NAMES.outline}"`);
  return worker;
}

if (require.main === module) {
  startOutlineWorker();
}
