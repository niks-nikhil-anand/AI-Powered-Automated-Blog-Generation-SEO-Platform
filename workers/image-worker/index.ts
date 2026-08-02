import { Worker } from "bullmq";
import { qualityQueue, QUEUE_NAMES, type ImageJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { workerOptions } from "../shared/worker-options";
import { generateEditorialHeroImage } from "./generator";
import { uploadToS3 } from "./storage";
import {
  assertGate,
  failWorkerAttempt,
  passWorkerAttempt,
  scoreRequiredFields,
  startWorkerAttempt,
  QualityGateError,
} from "../shared/recovery";

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
  const blog = await prisma.blog.findUnique({ where: { id: payload.blogId }, include: { featuredImage: true } });
  if (!blog) throw new Error(`Blog ${payload.blogId} not found`);
  if (blog.featuredImageId) {
    await qualityQueue.add("quality_check_blog", { blogId: blog.id });
    const output = { blogId: blog.id, assetId: blog.featuredImageId, skipped: true };
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output,
      nextStage: "quality-worker",
    });
    return output;
  }

  try {
    const image = generateEditorialHeroImage(payload);
    const key = objectKey(payload.slug, image.fileName);
    const uploaded = await uploadToS3(key, image.buffer, image.mimeType);
    const uploadGate = scoreRequiredFields("image-worker", [
      { label: "generated image buffer", ok: image.buffer.length > 0 },
      { label: "mime type", ok: Boolean(image.mimeType) },
      { label: "S3 bucket", ok: Boolean(uploaded.bucket) },
      { label: "S3 key", ok: Boolean(uploaded.key) },
      { label: "CDN public URL", ok: Boolean(uploaded.publicUrl) },
    ]);
    assertGate(uploadGate);

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
      },
    });

    await prisma.blog.update({
      where: { id: blog.id },
      data: { featuredImageId: asset.id },
    });
    await qualityQueue.add("quality_check_blog", { blogId: blog.id });
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

  log.info(`Image worker listening on "${QUEUE_NAMES.image}"`);
  return worker;
}

if (require.main === module) {
  startImageWorker();
}
