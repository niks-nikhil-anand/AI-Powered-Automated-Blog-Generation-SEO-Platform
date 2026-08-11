-- Research engine upgrade (docs/RESEARCH_ENGINE_UPGRADE.md). Additive-only and
-- rollback-safe: every new Trend column is nullable and ResearchRun is a brand
-- new table, so no existing row or code path is affected until the feature
-- flags (RESEARCH_ENGINE_ENABLED / SEARXNG_ENABLED) are turned on.

-- AlterTable
ALTER TABLE "Trend" ADD COLUMN     "canonicalUrl" TEXT;
ALTER TABLE "Trend" ADD COLUMN     "topicFingerprint" TEXT;
ALTER TABLE "Trend" ADD COLUMN     "topicEmbedding" JSONB;
ALTER TABLE "Trend" ADD COLUMN     "researchDetail" JSONB;

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "metrics" JSONB NOT NULL,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "bestScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL DEFAULT 'ok',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trend_topicFingerprint_idx" ON "Trend"("topicFingerprint");

-- CreateIndex
CREATE INDEX "Trend_canonicalUrl_idx" ON "Trend"("canonicalUrl");

-- CreateIndex
CREATE INDEX "ResearchRun_createdAt_idx" ON "ResearchRun"("createdAt");
