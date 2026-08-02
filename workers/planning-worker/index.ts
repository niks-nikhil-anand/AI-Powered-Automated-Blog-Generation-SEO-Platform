import { Worker } from "bullmq";
import { outlineQueue, QUEUE_NAMES, type PlanningJobPayload } from "../shared/queues";
import { prisma } from "../shared/prisma";
import { logger } from "../shared/logger";
import { generateContentPlan } from "./vertex";
import { workerOptions } from "../shared/worker-options";

const log = logger.child({ worker: "planning-worker" });

async function planTopic(payload: PlanningJobPayload) {
  const trend = await prisma.trend.findUnique({ where: { id: payload.trendId } });
  if (!trend) throw new Error(`Trend ${payload.trendId} not found`);

  const { plan, usage, model } = await generateContentPlan(
    payload.topic,
    payload.category,
    payload.score,
    payload.evidenceSummary
  );

  const saved = await prisma.contentPlan.upsert({
    where: { trendId: payload.trendId },
    create: {
      trendId: payload.trendId,
      searchIntent: plan.searchIntent,
      audience: plan.audience,
      angle: plan.angle,
      primaryKeyword: plan.primaryKeyword,
      secondaryKeywords: plan.secondaryKeywords,
      competitorNotes: plan.competitorNotes,
      internalNotes: plan.internalNotes,
    },
    update: {
      searchIntent: plan.searchIntent,
      audience: plan.audience,
      angle: plan.angle,
      primaryKeyword: plan.primaryKeyword,
      secondaryKeywords: plan.secondaryKeywords,
      competitorNotes: plan.competitorNotes,
      internalNotes: plan.internalNotes,
    },
  });

  await prisma.aIUsage.create({
    data: {
      worker: "planning-worker",
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cost: 0,
      latency: 0,
    },
  });

  await outlineQueue.add("outline_blog", { trendId: payload.trendId, planId: saved.id });
  await prisma.trend.update({ where: { id: payload.trendId }, data: { status: "PLANNED" } });

  log.info(`Content plan saved for "${trend.topic}"`, { trendId: trend.id, planId: saved.id });
  return { trendId: trend.id, planId: saved.id };
}

export function startPlanningWorker() {
  const worker = new Worker(
    QUEUE_NAMES.planning,
    async (job) => planTopic(job.data as PlanningJobPayload),
    workerOptions(1)
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  log.info(`Planning worker listening on "${QUEUE_NAMES.planning}"`);
  return worker;
}

if (require.main === module) {
  startPlanningWorker();
}
