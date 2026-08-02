import { Worker } from "bullmq";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { QUEUE_NAMES, type OutlineJobPayload, writingQueue } from "../shared/queues";
import { generateContentOutline } from "./vertex";
import { workerOptions } from "../shared/worker-options";

const log = logger.child({ worker: "outline-worker" });

async function outlineTopic(payload: OutlineJobPayload) {
  const plan = await prisma.contentPlan.findUnique({
    where: { id: payload.planId },
    include: { trend: true },
  });
  if (!plan) throw new Error(`ContentPlan ${payload.planId} not found`);

  const { outline, usage, model } = await generateContentOutline(plan.trend.topic, plan.trend.category, plan);
  const saved = await prisma.contentOutline.upsert({
    where: { trendId: payload.trendId },
    create: {
      trendId: payload.trendId,
      planId: plan.id,
      title: outline.title,
      slug: outline.slug,
      metaTitle: outline.metaTitle,
      metaDescription: outline.metaDescription,
      sections: outline.sections,
      faqs: outline.faqs,
    },
    update: {
      title: outline.title,
      slug: outline.slug,
      metaTitle: outline.metaTitle,
      metaDescription: outline.metaDescription,
      sections: outline.sections,
      faqs: outline.faqs,
    },
  });

  await prisma.aIUsage.create({
    data: {
      worker: "outline-worker",
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cost: 0,
      latency: 0,
    },
  });

  await writingQueue.add("write_blog", {
    trendId: payload.trendId,
    outlineId: saved.id,
    topic: saved.title,
    description: plan.angle,
  });

  log.info(`Content outline saved for "${plan.trend.topic}"`, {
    trendId: plan.trend.id,
    outlineId: saved.id,
  });
  return { trendId: plan.trend.id, outlineId: saved.id };
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
