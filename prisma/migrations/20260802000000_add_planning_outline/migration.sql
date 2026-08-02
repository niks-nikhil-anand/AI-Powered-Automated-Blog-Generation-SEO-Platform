-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "trendId" TEXT NOT NULL,
    "searchIntent" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "primaryKeyword" TEXT NOT NULL,
    "secondaryKeywords" JSONB NOT NULL,
    "competitorNotes" JSONB NOT NULL,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentOutline" (
    "id" TEXT NOT NULL,
    "trendId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "metaTitle" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "faqs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentOutline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentPlan_trendId_key" ON "ContentPlan"("trendId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentOutline_trendId_key" ON "ContentOutline"("trendId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentOutline_planId_key" ON "ContentOutline"("planId");

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOutline" ADD CONSTRAINT "ContentOutline_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOutline" ADD CONSTRAINT "ContentOutline_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
