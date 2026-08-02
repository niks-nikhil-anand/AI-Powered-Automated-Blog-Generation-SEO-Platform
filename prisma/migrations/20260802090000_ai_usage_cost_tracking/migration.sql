-- Link AI spend to the blog / trend it was incurred for, so the dashboard can
-- report real cost-per-blog instead of a hardcoded $0.00.

ALTER TABLE "AIUsage" ADD COLUMN "blogId" TEXT;
ALTER TABLE "AIUsage" ADD COLUMN "trendId" TEXT;

ALTER TABLE "AIUsage"
  ADD CONSTRAINT "AIUsage_blogId_fkey"
  FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AIUsage_blogId_idx" ON "AIUsage"("blogId");
CREATE INDEX "AIUsage_createdAt_idx" ON "AIUsage"("createdAt");
CREATE INDEX "AIUsage_worker_createdAt_idx" ON "AIUsage"("worker", "createdAt");
CREATE INDEX "AIUsage_model_createdAt_idx" ON "AIUsage"("model", "createdAt");

-- Backfill cost for rows written before pricing was wired up.
-- Vertex AI list price, USD per 1M tokens. Keep in sync with
-- workers/shared/pricing.ts MODEL_PRICING.
UPDATE "AIUsage"
SET "cost" = (("promptTokens" * 1.25) + ("completionTokens" * 10.0)) / 1000000.0
WHERE "cost" = 0 AND "model" LIKE 'gemini-2.5-pro%';

UPDATE "AIUsage"
SET "cost" = (("promptTokens" * 0.10) + ("completionTokens" * 0.40)) / 1000000.0
WHERE "cost" = 0 AND "model" LIKE 'gemini-2.5-flash-lite%';

UPDATE "AIUsage"
SET "cost" = (("promptTokens" * 0.30) + ("completionTokens" * 2.50)) / 1000000.0
WHERE "cost" = 0 AND "model" LIKE 'gemini-2.5-flash%';
