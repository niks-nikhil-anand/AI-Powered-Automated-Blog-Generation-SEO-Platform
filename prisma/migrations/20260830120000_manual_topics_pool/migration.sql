-- Persistent secondary/fallback source for manually curated research topics.
CREATE TYPE "ManualTopicStatus" AS ENUM ('PENDING', 'RESEARCHING', 'QUALIFIED', 'SELECTED', 'USED', 'REJECTED', 'ARCHIVED');
CREATE TYPE "ManualTopicPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TABLE "ManualTopic" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "keywords" TEXT[] NOT NULL,
    "category" TEXT,
    "priority" "ManualTopicPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "ManualTopicStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "usedAt" TIMESTAMP(3),
    "lastResearchedAt" TIMESTAMP(3),
    "lastResearchScore" DOUBLE PRECISION,
    "lastFailureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManualTopic_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManualTopic_status_idx" ON "ManualTopic"("status");
CREATE INDEX "ManualTopic_priority_idx" ON "ManualTopic"("priority");
CREATE INDEX "ManualTopic_createdAt_idx" ON "ManualTopic"("createdAt");
CREATE INDEX "ManualTopic_usedAt_idx" ON "ManualTopic"("usedAt");
CREATE INDEX "ManualTopic_lastResearchedAt_idx" ON "ManualTopic"("lastResearchedAt");
