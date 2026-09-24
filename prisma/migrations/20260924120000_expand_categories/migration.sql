-- Expand category management while keeping existing category and blog data.
ALTER TABLE "Category" ADD COLUMN "description" TEXT;
ALTER TABLE "Category" ADD COLUMN "color" TEXT NOT NULL DEFAULT '#6366f1';
ALTER TABLE "Category" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Category" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BlogInput" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "Category_isActive_sortOrder_idx" ON "Category"("isActive", "sortOrder");
CREATE INDEX "BlogInput_categoryId_idx" ON "BlogInput"("categoryId");
ALTER TABLE "BlogInput" ADD CONSTRAINT "BlogInput_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
