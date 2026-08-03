-- Small key/value store backing the Settings page's AI-model-per-stage
-- picker and daily blog goal, neither of which had any persistence before
-- this migration - both were local useState that reset on reload.

CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
