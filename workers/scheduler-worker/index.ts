import { Worker, Job } from "bullmq";
import { QUEUE_NAMES, schedulerQueue } from "../shared/queues";
import { logger } from "../shared/logger";
import { withPipelineRetryPolicy } from "../shared/pipeline-retry-policy";
import { env } from "../shared/env";
import { workerOptions } from "../shared/worker-options";
import {
  dispatchBlogInput,
  getDailyTargetStatus,
  nextEligibleBlogInput,
  reconcileDailyTarget,
} from "../shared/daily-target";
import { getSetting, getSettingFresh } from "../shared/settings";
import {
  RECONCILE_SLOT_ID,
  blogSlotId,
  getPublishSlotView,
  parseSlotTime,
  reconcilePublishSlots,
  setPublishTarget,
  slotSettingKey,
} from "../shared/publish-slots";
import { failWorkerAttempt, passWorkerAttempt, startWorkerAttempt } from "../shared/recovery";
import { logVertexRuntimeConfig } from "../shared/vertex";

const log = logger.child({ worker: "scheduler-worker" });

/**
 * Worker 0: the cron end of the pipeline. It generates nothing itself - it
 * only decides WHEN a already-submitted BlogInput starts moving.
 *
 * Two job kinds:
 *  - "reconcile-daily-target": the safety-net tick (workers/shared/daily-target.ts)
 *    that tops today's pipeline up from the eligible submission backlog.
 *  - "scheduled-slot": one configured run time fired; take the next eligible
 *    submission (PENDING, then CANCELLED, then FAILED) and start it now.
 *
 * This replaced the research worker, which used to own both schedulers on
 * top of doing trend discovery. Discovery is gone; the schedules are not.
 */
async function runScheduledSlot(slotNumber: number) {
  const targetPublishAt = Date.now();
  const attempt = await startWorkerAttempt({
    worker: "scheduler-worker",
    input: { slot: slotNumber, targetPublishAt: new Date(targetPublishAt).toISOString() },
  });

  try {
    const parsed = parseSlotTime(await getSettingFresh<string | null>(slotSettingKey(slotNumber), null));
    if (!parsed) {
      const output = { slot: slotNumber, dispatchedCount: 0, reason: "slot_unconfigured" };
      log.warn(`Publish slot ${slotNumber} fired without a configured time - skipping (set it in Settings)`);
      await passWorkerAttempt({
        workflowRunId: attempt.workflow.id,
        attemptId: attempt.attempt.id,
        output,
        nextStage: "stopped",
      });
      return output;
    }

    log.info(`Publish slot ${slotNumber} fired - starting one blog now (${env.TIMEZONE})`);

    // The Daily Blog Goal is a ceiling as well as a floor: a slot that fires
    // after the day is already covered leaves the backlog alone.
    const status = await getDailyTargetStatus();
    if (status.remaining <= 0) {
      const output = { slot: slotNumber, dispatchedCount: 0, reason: "daily_target_already_met", ...status };
      log.info(`Publish slot ${slotNumber}: daily target ${status.target} already met - nothing dispatched`, output);
      await passWorkerAttempt({
        workflowRunId: attempt.workflow.id,
        attemptId: attempt.attempt.id,
        output,
        nextStage: "stopped",
      });
      return output;
    }

    const input = await nextEligibleBlogInput();
    if (!input) {
      const output = { slot: slotNumber, dispatchedCount: 0, reason: "no_eligible_submission", ...status };
      log.warn(
        `Publish slot ${slotNumber}: no eligible blog submission in the backlog - queue one at /dashboard/blogs/new`,
        output
      );
      await passWorkerAttempt({
        workflowRunId: attempt.workflow.id,
        attemptId: attempt.attempt.id,
        output,
        nextStage: "stopped",
      });
      return output;
    }

    // The slot's target publish time rides down the chain via Redis (keyed by
    // blogInputId) - quality-worker reads it when queueing the publish job and
    // holds the blog until then.
    await setPublishTarget(input.id, targetPublishAt);
    await dispatchBlogInput(input);

    const output = { slot: slotNumber, dispatchedCount: 1, blogInputId: input.id, title: input.title, pickedStatus: input.status };
    log.info(
      `Publish slot ${slotNumber}: dispatched "${input.title}" targeting ${new Date(targetPublishAt).toISOString()}`,
      output
    );
    await passWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      output,
      qualityReport: {
        stage: "scheduler-worker",
        score: 100,
        passed: true,
        reasons: [`Dispatched submission "${input.title}" for slot ${slotNumber}`],
      },
      nextStage: "planning-worker",
      blogInputId: input.id,
    });
    return output;
  } catch (err) {
    await failWorkerAttempt({
      workflowRunId: attempt.workflow.id,
      attemptId: attempt.attempt.id,
      error: err,
    });
    throw err;
  }
}

/**
 * Schedule registration = the daily-target reconcile tick + the dynamic
 * publish slots (one per Daily Blog Goal, times from AppSetting). BullMQ v5+
 * upsertJobScheduler is idempotent, safe on every boot; anything else still
 * registered - including the legacy research schedulers from the pre-slot
 * system - is removed as stale.
 */
async function registerSchedules() {
  if (!env.SCHEDULER_ENABLED) {
    log.info("SCHEDULER_ENABLED=false - skipping schedule registration");
    return;
  }

  await schedulerQueue.upsertJobScheduler(
    RECONCILE_SLOT_ID,
    { pattern: env.RECONCILE_CRON, tz: env.TIMEZONE },
    { name: "reconcile-daily-target", data: {} }
  );
  log.info(`Registered daily-target reconcile schedule "${env.RECONCILE_CRON}" (${env.TIMEZONE})`);

  const slotCount = await reconcilePublishSlots();
  const configured = (await getPublishSlotView()).filter((slot) => slot.configured).length;
  log.info(`Reconciled publish slots: ${configured} configured of ${slotCount} (daily blog goal)`);

  // Retire anything that isn't the reconcile tick or a currently-live slot.
  const wanted = new Set<string>([RECONCILE_SLOT_ID]);
  for (let n = 1; n <= slotCount; n += 1) {
    const parsed = parseSlotTime(await getSetting<string | null>(slotSettingKey(n), null));
    if (parsed) wanted.add(blogSlotId(n));
  }
  const existing = await schedulerQueue.getJobSchedulers();
  for (const scheduler of existing) {
    if (scheduler.key && !wanted.has(scheduler.key)) {
      await schedulerQueue.removeJobScheduler(scheduler.key);
      log.warn(`Removed stale job scheduler "${scheduler.key}"`);
    }
  }
}

export function startSchedulerWorker() {
  const worker = new Worker(
    QUEUE_NAMES.scheduler,
    (job: Job) =>
      withPipelineRetryPolicy(async () => {
        if (job.name === "scheduled-slot") return await runScheduledSlot(Number(job.data.slot));
        return await reconcileDailyTarget();
      }),
    { ...workerOptions(1) }
  );

  worker.on("completed", (job, result) => log.info(`Job ${job.id} completed`, result));
  worker.on("failed", (job, err) => log.error(`Job ${job?.id ?? "?"} failed: ${err.message}`));

  registerSchedules().catch((err) => log.error(`Failed to register schedules: ${err.message}`));

  logVertexRuntimeConfig(log);
  log.info(`Scheduler worker listening on "${QUEUE_NAMES.scheduler}"`);
  return worker;
}

// Only auto-start when this file is run directly (`npm run worker:scheduler`),
// not when imported by workers/start.ts.
if (require.main === module) {
  startSchedulerWorker();
}
