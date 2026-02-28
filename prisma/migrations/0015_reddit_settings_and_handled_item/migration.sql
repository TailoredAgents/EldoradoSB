-- CreateTable
CREATE TABLE "public"."HandledItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "lastError" TEXT,
    "retryAfter" TIMESTAMP(3),

    CONSTRAINT "HandledItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandledItem_platform_status_idx" ON "public"."HandledItem"("platform", "status");

-- CreateIndex
CREATE INDEX "HandledItem_createdAt_idx" ON "public"."HandledItem"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HandledItem_platform_type_externalId_key" ON "public"."HandledItem"("platform", "type", "externalId");

-- CreateTable
CREATE TABLE "public"."RedditAccountSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxCommentsPerDay" INTEGER NOT NULL DEFAULT 8,
    "maxCommentsPerRun" INTEGER NOT NULL DEFAULT 2,
    "ctaPercent" INTEGER NOT NULL DEFAULT 15,
    "config" JSONB,

    CONSTRAINT "RedditAccountSettings_pkey" PRIMARY KEY ("id")
);

