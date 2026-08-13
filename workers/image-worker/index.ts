import { Worker } from "bullmq";
import { JOB_IDS, qualityQueue, QUEUE_NAMES, type ImageJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { workerOptions } from "../shared/worker-options";
import { recentImageHashes, selectHeroImage } from "./select";
import { uploadToS3, deleteFromS3 } from "./storage";
import {
  assertGate,
  failWorkerAttempt,
  passWorkerAttempt,
  scoreRequiredFields,
  startWorkerAttempt,
  QualityGateError,
} from "../shared/recovery";
import { logVertexRuntimeConfig } from "../shared/vertex";

const log = logger.child({ worker: "image-worker" });

function objectKey(slug: string, fileName: string) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `blogs/${year}/${month}/${slug}/${fileName}`;
}

export async function generateImageForBlog(payload: ImageJobPayload) {
  const attempt = await startWorkerAttempt({
    worker: "image-worker",
    trendId: payload.trendId,
    blogId: payload.blogId,
    input: payload,
  });
  const blog = await prisma.blog.findUnique({
    where: { id: payload.blogId },
    include: { featuredImage: true, trend: { include: { plan: true } } },
  });
  if (!blog) throw new Error(`Blog ${payload.blogId} not found`);
  if (blog.featuredImageId) {
    // Epoch-keyed jobId: every pass-through must trigger a fresh QA scoring
    // run - entity-keying this would dedupe away legitimate re-scores.
    await qualityQueue.add("quality_check_blog", { blogId: blog.id }, { jobId: JOB_IDS.quality(blog.id, attempt.attempt.id) });
    const output = { blogId: blog.id, assetId: blog.featuredImageId, skipped: true };
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output,
      nextStage: "quality-worker",
    });
    return output;
  }

  let uploadedKey: string | null = null;

  try {
    // ContentPlan.primaryKeyword names the central visual subject; Trend.topic
    // is the fallback for when planning-worker hasn't attached a plan yet.
    const subject = blog.trend?.plan?.primaryKeyword || blog.trend?.topic || payload.title;
    const recentHashes = await recentImageHashes();
    const { image, styleDirection, imageHash } = await selectHeroImage(payload, subject, recentHashes);
    const key = objectKey(payload.slug, image.fileName);
    const uploaded = await uploadToS3(key, image.buffer, image.mimeType);
    uploadedKey = key; // Track for cleanup if gate fails

    const uploadGate = scoreRequiredFields("image-worker", [
      { label: "generated image buffer", ok: image.buffer.length > 0 },
      { label: "mime type", ok: Boolean(image.mimeType) },
      { label: "S3 bucket", ok: Boolean(uploaded.bucket) },
      { label: "S3 key", ok: Boolean(uploaded.key) },
      { label: "CDN public URL", ok: Boolean(uploaded.publicUrl) },
    ]);

    try {
      assertGate(uploadGate);
    } catch (error) {
      // Delete S3 file if gate check fails to prevent orphaning
      if (uploadedKey) {
        await deleteFromS3(uploadedKey).catch((err) => {
          log.error("Failed to cleanup S3 file after gate failure:", err);
        });
      }
      throw error;
    }

    const asset = await prisma.asset.create({
      data: {
        fileName: image.fileName,
        bucket: uploaded.bucket,
        path: uploaded.key,
        publicUrl: uploaded.publicUrl,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        size: uploaded.size,
        imageHash,
        styleDirection,
      },
    });

    await prisma.blog.update({
      where: { id: blog.id },
      data: { featuredImageId: asset.id },
    });
    await qualityQueue.add("quality_check_blog", { blogId: blog.id }, { jobId: JOB_IDS.quality(blog.id, attempt.attempt.id) });
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output: { blogId: blog.id, assetId: asset.id, path: uploaded.key, publicUrl: uploaded.publicUrl },
      qualityReport: uploadGate,
      nextStage: "quality-worker",
    });

    log.info(`Image generated for "${payload.title}"`, {
      blogId: blog.id,
      assetId: asset.id,
      path: uploaded.key,
    });

    return { blogId: blog.id, assetId: asset.id, path: uploaded.key };
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

export function startImageWorker() {
  const worker = new Worker(
    QUEUE_NAMES.image,
    async (job) => generateImageForBlog(job.data as ImageJobPayload),
    workerOptions(1)
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  logVertexRuntimeConfig(log);
  log.info(`Image worker listening on "${QUEUE_NAMES.image}"`);
  return worker;
}

if (require.main === module) {
  startImageWorker();
}
