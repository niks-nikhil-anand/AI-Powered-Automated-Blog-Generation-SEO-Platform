import { Worker } from "bullmq";
import { publishQueue, QUEUE_NAMES, type QualityJobPayload, writingQueue, type WritingJobPayload } from "../shared/queues";
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

const log = logger.child({ worker: "quality-worker" });

export async function runQualityCheck(payload: QualityJobPayload) {
  const attempt = await startWorkerAttempt({
    worker: "quality-worker",
    blogId: payload.blogId,
    input: payload,
  });
  const blog = await prisma.blog.findUnique({
    where: { id: payload.blogId },
    include: { seo: true, featuredImage: true },
  });
  if (!blog) throw new Error(`Blog ${payload.blogId} not found`);

  const report = scoreBlogQuality(blog);

  const saved = await prisma.qualityReport.upsert({
    where: { blogId: blog.id },
    create: {
      blogId: blog.id,
      overallScore: report.overallScore,
      ...report.scores,
      passed: report.passed,
      recommendation: report.recommendation,
      checks: report.checks,
    },
    update: {
      overallScore: report.overallScore,
      ...report.scores,
      passed: report.passed,
      recommendation: report.recommendation,
      checks: report.checks,
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
    passed: report.overallScore >= 90,
    reasons: report.checks
      .filter((check) => check.score < 9)
      .map((check) => `${check.label}: ${check.score}/${check.maxScore}`),
  };

  if (report.overallScore >= 90) {
    await publishQueue.add("publish_blog", {
      blogId: blog.id,
      qualityReportId: saved.id,
    });
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
          take: 1,
        },
      },
    });
    const writingAttemptCount = workflow
      ? await prisma.workerAttempt.count({
          where: { workflowRunId: workflow.id, worker: "writing-worker" },
        })
      : 0;
    const lastWritingInput = workflow?.attempts[0]?.input as WritingJobPayload | undefined;

    if (lastWritingInput && writingAttemptCount < 4) {
      await writingQueue.add("write_blog", {
        ...lastWritingInput,
        recoveryContext: {
          reason: "final_quality_below_threshold",
          qualityReport: gate,
        },
      });
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
        error: `Quality score ${report.overallScore} below 90 after writing retries`,
        qualityReport: gate,
      });
    }
    await prisma.blog.update({
      where: { id: blog.id },
      data: { status: lastWritingInput && writingAttemptCount < 4 ? "PENDING_REVIEW" : "FAILED" },
    });
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
    async (job) => runQualityCheck(job.data as QualityJobPayload),
    workerOptions(1)
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  log.info(`Quality worker listening on "${QUEUE_NAMES.quality}"`);
  return worker;
}

if (require.main === module) {
  startQualityWorker();
}
