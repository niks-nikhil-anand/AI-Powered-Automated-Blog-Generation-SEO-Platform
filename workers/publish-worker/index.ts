import { Worker } from "bullmq";
import { QUEUE_NAMES, type PublishJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { workerOptions } from "../shared/worker-options";
import {
  assertGate,
  failWorkerAttempt,
  passWorkerAttempt,
  scoreRequiredFields,
  startWorkerAttempt,
  QualityGateError,
} from "../shared/recovery";

const log = logger.child({ worker: "publish-worker" });

export async function publishBlog(payload: PublishJobPayload) {
  const attempt = await startWorkerAttempt({
    worker: "publish-worker",
    blogId: payload.blogId,
    input: payload,
  });
  const blog = await prisma.blog.findUnique({
    where: { id: payload.blogId },
    include: { qualityReport: true, featuredImage: true, seo: true },
  });
  if (!blog) throw new Error(`Blog ${payload.blogId} not found`);
  try {
    if (!blog.qualityReport) throw new Error(`Blog ${payload.blogId} has no quality report`);
    if (blog.qualityReport.id !== payload.qualityReportId) {
      throw new Error(`Quality report mismatch for blog ${payload.blogId}`);
    }
    const gate = scoreRequiredFields("publish-worker", [
      { label: "QA score >= 90", ok: blog.qualityReport.overallScore >= 90 },
      { label: "featured image", ok: Boolean(blog.featuredImageId) },
      { label: "SEO record", ok: Boolean(blog.seo) },
      { label: "content", ok: Boolean(blog.content) },
      { label: "HTML", ok: Boolean(blog.html) },
    ]);
    assertGate(gate);

    const published = await prisma.blog.update({
      where: { id: blog.id },
      data: { status: "PUBLISHED" },
    });
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output: {
        blogId: published.id,
        status: published.status,
        score: blog.qualityReport.overallScore,
        published: true,
      },
      qualityReport: gate,
    });

    log.info(`Blog published: "${published.title}"`, {
      blogId: published.id,
      score: blog.qualityReport.overallScore,
    });

    return {
      blogId: published.id,
      status: published.status,
      score: blog.qualityReport.overallScore,
      published: true,
    };
  } catch (err) {
    await prisma.blog.update({ where: { id: blog.id }, data: { status: "PENDING_REVIEW" } });
    await failWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      error: err,
      qualityReport: err instanceof QualityGateError ? err.report : undefined,
    });
    throw err;
  }
}

export function startPublishWorker() {
  const worker = new Worker(
    QUEUE_NAMES.publish,
    async (job) => publishBlog(job.data as PublishJobPayload),
    workerOptions(1)
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  log.info(`Publish worker listening on "${QUEUE_NAMES.publish}"`);
  return worker;
}

if (require.main === module) {
  startPublishWorker();
}
