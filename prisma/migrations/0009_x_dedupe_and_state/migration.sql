-- CreateEnum
CREATE TYPE "public"."XHandledItemType" AS ENUM (
  'mention_tweet',
  'dm_event',
  'outbound_target_tweet',
  'autopost_slot'
);

-- CreateEnum
CREATE TYPE "public"."XHandledItemStatus" AS ENUM ('reserved', 'done', 'error');

-- CreateTable
CREATE TABLE "public"."XHandledItem" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "type" "public"."XHandledItemType" NOT NULL,
  "externalId" TEXT NOT NULL,
  "status" "public"."XHandledItemStatus" NOT NULL DEFAULT 'reserved',
  "lastError" TEXT,
  CONSTRAINT "XHandledItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."XAccountState" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastMentionId" TEXT,
  "lastDmEventId" TEXT,
  CONSTRAINT "XAccountState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "XHandledItem_type_externalId_key" ON "public"."XHandledItem"("type", "externalId");

-- CreateIndex
CREATE INDEX "XHandledItem_type_idx" ON "public"."XHandledItem"("type");

-- CreateIndex
CREATE INDEX "XHandledItem_status_idx" ON "public"."XHandledItem"("status");

-- CreateIndex
CREATE INDEX "XHandledItem_createdAt_idx" ON "public"."XHandledItem"("createdAt");
