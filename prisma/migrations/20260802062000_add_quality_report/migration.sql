CREATE TABLE "QualityReport" (
    "id" TEXT NOT NULL,
    "blogId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "seoStructure" INTEGER NOT NULL,
    "contentCompleteness" INTEGER NOT NULL,
    "readability" INTEGER NOT NULL,
    "contentQuality" INTEGER NOT NULL,
    "keywordOptimization" INTEGER NOT NULL,
    "technicalSeo" INTEGER NOT NULL,
    "formattingUx" INTEGER NOT NULL,
    "mediaQuality" INTEGER NOT NULL,
    "aiFactQuality" INTEGER NOT NULL,
    "publishingReadiness" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "recommendation" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QualityReport_blogId_key" ON "QualityReport"("blogId");

ALTER TABLE "QualityReport" ADD CONSTRAINT "QualityReport_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
