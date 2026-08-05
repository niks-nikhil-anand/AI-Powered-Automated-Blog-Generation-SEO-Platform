-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "imageHash" TEXT,
ADD COLUMN     "styleDirection" TEXT;

-- CreateIndex
CREATE INDEX "Asset_createdAt_idx" ON "Asset"("createdAt");
