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
import { reconcileDailyTarget } from "../shared/daily-target";
import { logVertexRuntimeConfig } from "../shared/vertex";

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

    // Guards against double-processing a redelivered job (e.g. after a
    // crash between the DB write and the BullMQ ack) re-running side
    // effects a second time - `count` is 0 when another run already won.
    const { count } = await prisma.blog.updateMany({
      where: { id: blog.id, status: { not: "PUBLISHED" } },
      data: { status: "PUBLISHED" },
    });
    if (count === 0) {
      log.info(`Blog ${blog.id} already published, skipping`);
      await passWorkerAttempt({
        workflowRunId: attempt.workflow.id,
        attemptId: attempt.attempt.id,
        output: { blogId: blog.id, status: "PUBLISHED", score: blog.qualityReport.overallScore, published: true, alreadyPublished: true },
        qualityReport: gate,
      });
      return { blogId: blog.id, status: "PUBLISHED", score: blog.qualityReport.overallScore, published: true };
    }
    const published = { ...blog, status: "PUBLISHED" as const };
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
    // A publish failure takes this blog out of today's count just like a
    // permanent QA failure would - top up from backlog immediately rather
    // than waiting for the next scheduled reconcile tick.
    await reconcileDailyTarget().catch((reconcileErr) =>
      log.error(`Daily target reconcile failed after publish failure: ${reconcileErr.message}`)
    );
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

  // Boot fingerprint (docs/VERTEX_429_RESOLUTION_PLAN.md Step 1.2) - publish
  // calls no Vertex API, but logging the config here too proves the container
  // is running the resilience build when grepping `docker compose logs`.
  logVertexRuntimeConfig(log);
  log.info(`Publish worker listening on "${QUEUE_NAMES.publish}"`);
  return worker;
}

if (require.main === module) {
  startPublishWorker();
}
