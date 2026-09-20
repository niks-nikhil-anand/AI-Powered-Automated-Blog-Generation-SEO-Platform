import { Worker } from "bullmq";
import { JOB_IDS, publishQueue, QUEUE_NAMES, type QualityJobPayload, writingQueue, type WritingJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { workerOptions } from "../shared/worker-options";
import { scoreBlogQuality } from "./scorer";
import {
  failWorkerAttempt,
  passWorkerAttempt,
  startWorkerAttempt,
  type QualityGateReport,
} from "../shared/recovery";
import { logVertexRuntimeConfig } from "../shared/vertex";
import { reconcileDailyTarget } from "../shared/daily-target";
import { getPublishTarget } from "../shared/publish-slots";
import { getRetryAttempts } from "../shared/retry-config";
import { withPipelineRetryPolicy } from "../shared/pipeline-retry-policy";
import { withVertexTelemetryContext } from "../shared/vertex-telemetry-context";
import { failBlogInput } from "../shared/blog-input";

const log = logger.child({ worker: "quality-worker" });
export const MAX_WRITING_REPAIR_ATTEMPTS = 2;

export async function runQualityCheck(payload: QualityJobPayload) {
  const attempt = await startWorkerAttempt({
    worker: "quality-worker",
    blogId: payload.blogId,
    input: payload,
  });
  const blog = await prisma.blog.findUnique({
    where: { id: payload.blogId },
    // plan rides along for the Task 4 judge (it scores usefulness against
    // the plan's stated intent, not in a vacuum).
    include: { seo: true, featuredImage: true, blogInput: { include: { plan: true, outline: true } } },
  });
  if (!blog) throw new Error(`Blog ${payload.blogId} not found`);

  const report = await scoreBlogQuality({
    ...blog,
    plan: blog.blogInput?.plan ?? null,
    outline: blog.blogInput?.outline ?? null,
  });

  // undefined (not null) for the Task 3/4 detail columns when those paths
  // didn't run - legacy reports must not get their new fields nulled out
  // on a re-score with the flags off.
  const detailColumns = {
    factCheckDetail: report.factCheckDetail ?? undefined,
    judgeDetail: report.judgeDetail ?? undefined,
  };

  const saved = await prisma.qualityReport.upsert({
    where: { blogId: blog.id },
    create: {
      blogId: blog.id,
      overallScore: report.overallScore,
      ...report.scores,
      passed: report.passed,
      recommendation: report.recommendation,
      checks: [...report.checks, ...(report.failures.length > 0 ? [{ label: "Structured Failures", score: 0, maxScore: 10, notes: report.failures.map((failure) => JSON.stringify(failure)) }] : [])],
      ...detailColumns,
    },
    update: {
      overallScore: report.overallScore,
      ...report.scores,
      passed: report.passed,
      recommendation: report.recommendation,
      checks: [...report.checks, ...(report.failures.length > 0 ? [{ label: "Structured Failures", score: 0, maxScore: 10, notes: report.failures.map((failure) => JSON.stringify(failure)) }] : [])],
      ...detailColumns,
    },
  });

  if (blog.seo) {
    await prisma.blogSEO.update({
      where: { blogId: blog.id },
      data: { score: report.overallScore },
    });
  }

  const gate: QualityGateReport = {
    stage: "quality-worker",
    score: report.overallScore,
    passed: report.passed,
    reasons: report.checks
      .filter((check) => check.score < 9)
      .map((check) => `${check.label}: ${check.score}/${check.maxScore}`),
  };
  if (report.failures.length > 0) {
    gate.reasons.push(...report.failures.slice(0, 10).map((failure) => `${failure.type}: ${failure.claim} - ${failure.reason}`));
  }
  const articleContractFailed = report.checks.some((check) => check.label === "Article Contract" && check.score < check.maxScore);

  if (report.passed) {
    await prisma.blog.update({
      where: { id: blog.id },
      data: { status: "PENDING_REVIEW" },
    });
    // Deterministic jobId - BullMQ refuses a second enqueue for the same
    // id outright, the idiomatic equivalent of a `publish:{blogId}:{date}`
    // idempotency key without hand-rolling a Redis check.
    //
    // Publish-slot hold: when this blog came from a scheduled slot, its
    // target publish time was recorded at dispatch (keyed by blogInputId).
    // Finishing early holds the publish job (BullMQ delayed job) until that
    // time; finishing at/past it (retries ran long) publishes immediately -
    // the blog is never abandoned for missing its slot.
    const targetPublishAt = blog.blogInputId ? await getPublishTarget(blog.blogInputId) : null;
    const holdMs = targetPublishAt ? Math.max(0, targetPublishAt - Date.now()) : 0;
    await publishQueue.add(
      "publish_blog",
      { blogId: blog.id, qualityReportId: saved.id },
      { jobId: JOB_IDS.publish(blog.id), delay: holdMs }
    );
    if (holdMs > 0) {
      log.info(
        `Blog ${blog.id} passed QA - holding publish until ${new Date(targetPublishAt!).toISOString()} (in ${Math.round(holdMs / 60000)}m)`
      );
    }
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output: { blogId: blog.id, reportId: saved.id, score: report.overallScore },
      qualityReport: gate,
      nextStage: "publish-worker",
    });
  } else {
    const workflow = await prisma.workflowRun.findFirst({
      where: { blogId: blog.id },
      orderBy: { createdAt: "desc" },
      include: {
        attempts: {
          where: { worker: "writing-worker" },
          orderBy: { startedAt: "desc" },
        },
      },
    });
    // Use fetched attempts array instead of separate count query (N+1 optimization)
    const writingAttemptCount = workflow?.attempts.length ?? 0;
    const lastWritingInput = workflow?.attempts[0]?.input as WritingJobPayload | undefined;

    // Dynamic budget from Settings' Retry Attempts (workers/shared/retry-config.ts):
    // N configured retries -> at most N+1 writing attempts before the blog is
    // a permanent QA failure. No hard-coded retry count anywhere.
    // At most two QA-triggered repair attempts; further failure means the
    // submission's own reference sources are too thin to support the article
    // it asks for, and the editor has to amend the brief.
    const maxWritingAttempts = Math.min((await getRetryAttempts()) + 1, MAX_WRITING_REPAIR_ATTEMPTS + 1);

    if (lastWritingInput && writingAttemptCount < maxWritingAttempts) {
      // Task 6.1: the concrete claims the fact check could not verify.
      // Until now the rewrite prompt only saw "Fact Verification: 5/10" and
      // hallucinated fresh claims on every retry; handing the writer the
      // exact failing claim texts makes the retry (and Task 6's
      // claim-repair path) targeted instead of blind. Empty on the legacy
      // sampled path (factCheckDetail is null there) - no behavior change.
      const factCheckIssues = (report.factCheckDetail?.claims ?? [])
        .filter((claim) => claim.verdict !== "supported")
        .slice(0, 10)
        .map(({ claim, verdict, note }) => ({ claim, verdict, note }));
      // Epoch-keyed deterministic jobId: unique per QA requeue (so it never
      // collides with the fresh write or a previous requeue) but stable
      // across retries of THIS quality job, which recount the same attempt
      // count - a crash-after-enqueue retry dedupes instead of doubling the
      // writing spend.
      await writingQueue.add(
        "write_blog",
        {
          ...lastWritingInput,
          recoveryContext: {
            reason: "final_quality_below_threshold",
            qualityReport: gate,
            // Task 4's actionable fixes - Task 5's targeted-repair path turns
            // these into section-level splices instead of a blind full rewrite.
            judgeFixes: report.judgeFixes,
            factCheckIssues,
          },
        },
        { jobId: JOB_IDS.writeQaRetry(lastWritingInput.blogInputId, writingAttemptCount) }
      );
      await passWorkerAttempt({
        workflowRunId: attempt.workflow.id,
        attemptId: attempt.attempt.id,
        output: { blogId: blog.id, reportId: saved.id, score: report.overallScore, recoveryQueued: true },
        qualityReport: gate,
        nextStage: "writing-worker",
      });
    } else {
      await failWorkerAttempt({
        workflowRunId: attempt.workflow.id,
        attemptId: attempt.attempt.id,
        error: report.failures.length > 0
          ? `INSUFFICIENT_EVIDENCE: the submission's sources could not support its claims after ${maxWritingAttempts - 1} repair attempts`
          : `Quality score ${report.overallScore} below 90 after writing retries`,
        qualityReport: gate,
      });
    }
    const recoveryQueued = Boolean(lastWritingInput && writingAttemptCount < maxWritingAttempts);
    const permanentlyFailed = !recoveryQueued;
    await prisma.blog.update({
      where: { id: blog.id },
      data: { status: permanentlyFailed || articleContractFailed ? "FAILED" : "PENDING_REVIEW" },
    });
    if (permanentlyFailed) {
      await failBlogInput(
        blog.blogInputId,
        new Error(`Quality score ${report.overallScore} stayed below 90 after ${maxWritingAttempts} writing attempt(s)`)
      );
      // A dead article must not shrink today's target - immediately try to
      // backfill from the backlog instead of waiting for the next scheduled
      // reconcile tick. See workers/shared/daily-target.ts.
      await reconcileDailyTarget().catch((err) =>
        log.error(`Daily target reconcile failed after permanent QA failure: ${err.message}`)
      );
    }
  }

  log.info(`Quality report saved for "${blog.title}"`, {
    blogId: blog.id,
    reportId: saved.id,
    score: report.overallScore,
    passed: report.passed,
  });

  return { blogId: blog.id, reportId: saved.id, score: report.overallScore, passed: report.passed };
}

export function startQualityWorker() {
  const worker = new Worker(
    QUEUE_NAMES.quality,
    async (job) => withVertexTelemetryContext(
      { jobId: String(job.id), queue: QUEUE_NAMES.quality, worker: "quality-worker", pipeline: "content", stage: "quality" },
      () => withPipelineRetryPolicy(() => runQualityCheck(job.data as QualityJobPayload))
    ),
    workerOptions(1)
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  logVertexRuntimeConfig(log);
  log.info(`Quality worker listening on "${QUEUE_NAMES.quality}"`);
  return worker;
}

if (require.main === module) {
  startQualityWorker();
}
