-- AlterTable
ALTER TABLE "Blog" ADD COLUMN     "byline" TEXT NOT NULL DEFAULT 'Drafted with AI assistance, DevKit Market Analysis';

-- AlterTable
ALTER TABLE "QualityReport" ADD COLUMN     "factVerification" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Trend" ADD COLUMN     "evidenceSummary" TEXT;
