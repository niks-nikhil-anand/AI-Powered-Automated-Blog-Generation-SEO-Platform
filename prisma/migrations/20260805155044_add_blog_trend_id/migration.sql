/*
  Warnings:

  - A unique constraint covering the columns `[trendId]` on the table `Blog` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Blog" ADD COLUMN     "trendId" TEXT;

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "worker" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "meta" JSONB,
    "workflowRunId" TEXT,
    "trendId" TEXT,
    "blogId" TEXT,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogEntry_timestamp_idx" ON "LogEntry"("timestamp");

-- CreateIndex
CREATE INDEX "LogEntry_level_timestamp_idx" ON "LogEntry"("level", "timestamp");

-- CreateIndex
CREATE INDEX "LogEntry_worker_timestamp_idx" ON "LogEntry"("worker", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Blog_trendId_key" ON "Blog"("trendId");

-- CreateIndex
CREATE INDEX "ContentOutline_trendId_idx" ON "ContentOutline"("trendId");

-- CreateIndex
CREATE INDEX "ContentOutline_planId_idx" ON "ContentOutline"("planId");

-- CreateIndex
CREATE INDEX "ContentPlan_trendId_idx" ON "ContentPlan"("trendId");

-- CreateIndex
CREATE INDEX "Trend_topic_createdAt_idx" ON "Trend"("topic", "createdAt");

-- CreateIndex
CREATE INDEX "Trend_status_idx" ON "Trend"("status");

-- AddForeignKey
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE SET NULL ON UPDATE CASCADE;
