-- Replace automated trend discovery with manually-submitted blog specifications.
--
-- Trend, ManualTopic and ResearchRun are dropped outright: nothing produces
-- them any more (the research worker is gone), and every stage that used to
-- read a Trend now reads a BlogInput instead. The trendId foreign keys on
-- Blog/ContentPlan/ContentOutline become blogInputId; AIUsage.trendId,
-- LogEntry.trendId and WorkflowRun.trendId become blogInputId columns.
--
-- Rows that referenced a Trend cannot be carried over (there is no BlogInput
-- to point them at), so the FK columns are recreated empty. Existing Blog
-- rows survive with blogInputId NULL - they keep their content, SEO, quality
-- report and featured image.

-- ---------------------------------------------------------------------------
-- New enums
-- ---------------------------------------------------------------------------
CREATE TYPE "BlogInputStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "BlogInputPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- ---------------------------------------------------------------------------
-- BlogInput
-- ---------------------------------------------------------------------------
CREATE TABLE "BlogInput" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "specs" JSONB NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secondaryKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience" TEXT,
    "searchIntent" TEXT,
    "tone" TEXT DEFAULT 'professional',
    "contentLength" INTEGER DEFAULT 2000,
    "category" TEXT,
    "outlineJson" JSONB,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "focusKeyword" TEXT,
    "evidenceArticles" JSONB,
    "evidenceSummary" TEXT,
    "priority" "BlogInputPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "BlogInputStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    CONSTRAINT "BlogInput_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlogInput_title_key" ON "BlogInput"("title");
CREATE UNIQUE INDEX "BlogInput_slug_key" ON "BlogInput"("slug");
CREATE INDEX "BlogInput_status_idx" ON "BlogInput"("status");
CREATE INDEX "BlogInput_priority_idx" ON "BlogInput"("priority");
CREATE INDEX "BlogInput_createdAt_idx" ON "BlogInput"("createdAt");
CREATE INDEX "BlogInput_processedAt_idx" ON "BlogInput"("processedAt");

-- ---------------------------------------------------------------------------
-- Drop the research-era tables (ContentPlan/ContentOutline cascade off Trend)
-- ---------------------------------------------------------------------------
ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_trendId_fkey";
ALTER TABLE "ContentPlan" DROP CONSTRAINT IF EXISTS "ContentPlan_trendId_fkey";
ALTER TABLE "ContentOutline" DROP CONSTRAINT IF EXISTS "ContentOutline_trendId_fkey";

DELETE FROM "ContentOutline";
DELETE FROM "ContentPlan";

DROP TABLE IF EXISTS "ResearchRun";
DROP TABLE IF EXISTS "ManualTopic";
DROP TABLE IF EXISTS "Trend";
DROP TYPE IF EXISTS "TrendStatus";
DROP TYPE IF EXISTS "ManualTopicStatus";
DROP TYPE IF EXISTS "ManualTopicPriority";

-- ---------------------------------------------------------------------------
-- Blog.trendId -> Blog.blogInputId
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "Blog_trendId_key";
ALTER TABLE "Blog" DROP COLUMN IF EXISTS "trendId";
ALTER TABLE "Blog" ADD COLUMN "blogInputId" TEXT;
CREATE UNIQUE INDEX "Blog_blogInputId_key" ON "Blog"("blogInputId");
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_blogInputId_fkey"
  FOREIGN KEY ("blogInputId") REFERENCES "BlogInput"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ContentPlan.trendId -> ContentPlan.blogInputId
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "ContentPlan_trendId_key";
DROP INDEX IF EXISTS "ContentPlan_trendId_idx";
ALTER TABLE "ContentPlan" DROP COLUMN IF EXISTS "trendId";
ALTER TABLE "ContentPlan" ADD COLUMN "blogInputId" TEXT NOT NULL;
CREATE UNIQUE INDEX "ContentPlan_blogInputId_key" ON "ContentPlan"("blogInputId");
CREATE INDEX "ContentPlan_blogInputId_idx" ON "ContentPlan"("blogInputId");
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_blogInputId_fkey"
  FOREIGN KEY ("blogInputId") REFERENCES "BlogInput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ContentOutline.trendId -> ContentOutline.blogInputId
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "ContentOutline_trendId_key";
DROP INDEX IF EXISTS "ContentOutline_trendId_idx";
ALTER TABLE "ContentOutline" DROP COLUMN IF EXISTS "trendId";
ALTER TABLE "ContentOutline" ADD COLUMN "blogInputId" TEXT NOT NULL;
CREATE UNIQUE INDEX "ContentOutline_blogInputId_key" ON "ContentOutline"("blogInputId");
CREATE INDEX "ContentOutline_blogInputId_idx" ON "ContentOutline"("blogInputId");
ALTER TABLE "ContentOutline" ADD CONSTRAINT "ContentOutline_blogInputId_fkey"
  FOREIGN KEY ("blogInputId") REFERENCES "BlogInput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Loose trendId columns -> blogInputId
-- ---------------------------------------------------------------------------
ALTER TABLE "AIUsage" RENAME COLUMN "trendId" TO "blogInputId";
UPDATE "AIUsage" SET "blogInputId" = NULL;

ALTER TABLE "LogEntry" RENAME COLUMN "trendId" TO "blogInputId";
UPDATE "LogEntry" SET "blogInputId" = NULL;

ALTER TABLE "WorkflowRun" RENAME COLUMN "trendId" TO "blogInputId";
UPDATE "WorkflowRun" SET "blogInputId" = NULL;
CREATE INDEX "WorkflowRun_blogInputId_idx" ON "WorkflowRun"("blogInputId");
CREATE INDEX "WorkflowRun_blogId_idx" ON "WorkflowRun"("blogId");
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_blogInputId_fkey"
  FOREIGN KEY ("blogInputId") REFERENCES "BlogInput"("id") ON DELETE SET NULL ON UPDATE CASCADE;
