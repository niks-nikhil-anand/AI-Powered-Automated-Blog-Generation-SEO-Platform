import { Worker } from "bullmq";
import { QUEUE_NAMES, type ImageJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { workerOptions } from "../shared/worker-options";
import { generateEditorialHeroImage } from "./generator";
import { uploadToS3 } from "./storage";

const log = logger.child({ worker: "image-worker" });

function objectKey(slug: string, fileName: string) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `blogs/${year}/${month}/${slug}/${fileName}`;
}

async function generateImageForBlog(payload: ImageJobPayload) {
  const blog = await prisma.blog.findUnique({ where: { id: payload.blogId }, include: { featuredImage: true } });
  if (!blog) throw new Error(`Blog ${payload.blogId} not found`);
  if (blog.featuredImageId) {
    return { blogId: blog.id, assetId: blog.featuredImageId, skipped: true };
  }

  const image = generateEditorialHeroImage(payload);
  const key = objectKey(payload.slug, image.fileName);
  const uploaded = await uploadToS3(key, image.buffer, image.mimeType);

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

  log.info(`Image generated for "${payload.title}"`, {
    blogId: blog.id,
    assetId: asset.id,
    path: uploaded.key,
  });

  return { blogId: blog.id, assetId: asset.id, path: uploaded.key };
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
