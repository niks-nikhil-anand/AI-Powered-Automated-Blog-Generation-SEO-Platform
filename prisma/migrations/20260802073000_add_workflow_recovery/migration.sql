CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "trendId" TEXT,
    "blogId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "currentStage" TEXT NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkerAttempt" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "worker" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "qualityReport" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WorkerAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerAttempt_workflowRunId_worker_idx" ON "WorkerAttempt"("workflowRunId", "worker");

ALTER TABLE "WorkerAttempt" ADD CONSTRAINT "WorkerAttempt_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
