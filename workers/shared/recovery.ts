import { prisma } from "./prisma";

export const QUALITY_THRESHOLD = 90;

export type QualityGateReport = {
  stage: string;
  score: number;
  passed: boolean;
  reasons: string[];
};

export class QualityGateError extends Error {
  report: QualityGateReport;

  constructor(report: QualityGateReport) {
    super(`${report.stage} quality gate failed: ${report.reasons.join("; ")}`);
    this.name = "QualityGateError";
    this.report = report;
  }
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

type AttemptInput = {
  worker: string;
  input: unknown;
  trendId?: string;
  blogId?: string;
};

async function getOrCreateWorkflow(input: AttemptInput) {
  if (!input.blogId && !input.trendId) {
    return prisma.workflowRun.create({
      data: {
        currentStage: input.worker,
      },
    });
  }

  // Use transaction to prevent race condition when checking and creating workflow
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workflowRun.findFirst({
      where: {
        status: { not: "PASSED" },
        OR: [
          ...(input.blogId ? [{ blogId: input.blogId }] : []),
          ...(input.trendId ? [{ trendId: input.trendId }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      return tx.workflowRun.update({
        where: { id: existing.id },
        data: {
          currentStage: input.worker,
          blogId: input.blogId ?? existing.blogId,
          trendId: input.trendId ?? existing.trendId,
        },
      });
    }

    return tx.workflowRun.create({
      data: {
        trendId: input.trendId,
        blogId: input.blogId,
        currentStage: input.worker,
      },
    });
  });
}

export async function startWorkerAttempt(input: AttemptInput) {
  const workflow = await getOrCreateWorkflow(input);
  const previousAttempts = await prisma.workerAttempt.count({
    where: { workflowRunId: workflow.id, worker: input.worker },
  });

  const attempt = await prisma.workerAttempt.create({
    data: {
      workflowRunId: workflow.id,
      worker: input.worker,
      attempt: previousAttempts + 1,
      input: jsonValue(input.input),
    },
  });

  return { workflow, attempt };
}

export async function passWorkerAttempt(params: {
  workflowRunId: string;
  attemptId: string;
  output?: unknown;
  qualityReport?: QualityGateReport;
  nextStage?: string;
  blogId?: string;
}) {
  await prisma.workerAttempt.update({
    where: { id: params.attemptId },
    data: {
      status: "PASSED",
      output: jsonValue(params.output),
      qualityReport: jsonValue(params.qualityReport),
      finishedAt: new Date(),
    },
  });

  await prisma.workflowRun.update({
    where: { id: params.workflowRunId },
    data: {
      status: params.nextStage ? "RUNNING" : "PASSED",
      currentStage: params.nextStage ?? "complete",
      blogId: params.blogId,
      failureReason: null,
    },
  });
}

export async function failWorkerAttempt(params: {
  workflowRunId: string;
  attemptId: string;
  error: unknown;
  qualityReport?: QualityGateReport;
}) {
  const error = params.error instanceof Error ? params.error.message : String(params.error);

  await prisma.workerAttempt.update({
    where: { id: params.attemptId },
    data: {
      status: "FAILED",
      error,
      qualityReport: jsonValue(params.qualityReport),
      finishedAt: new Date(),
    },
  });

  await prisma.workflowRun.update({
    where: { id: params.workflowRunId },
    data: {
      status: "FAILED",
      failureReason: error,
    },
  });
}

export function assertGate(report: QualityGateReport) {
  if (!report.passed || report.score < QUALITY_THRESHOLD) {
    throw new QualityGateError(report);
  }
}

export function scoreRequiredFields(stage: string, checks: { label: string; ok: boolean }[]): QualityGateReport {
  const missing = checks.filter((check) => !check.ok).map((check) => check.label);
  const score = Math.max(0, 100 - missing.length * 15);
  return {
    stage,
    score,
    passed: score >= QUALITY_THRESHOLD,
    reasons: missing.length > 0 ? missing.map((label) => `Missing or invalid ${label}`) : ["All required fields present"],
  };
}
