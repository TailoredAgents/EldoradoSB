-- CreateEnum
CREATE TYPE "public"."XActionType" AS ENUM (
  'post',
  'reply',
  'dm',
  'outbound_comment',
  'inbound_scan',
  'oauth_connect',
  'oauth_refresh'
);

-- CreateEnum
CREATE TYPE "public"."XActionStatus" AS ENUM ('success', 'skipped', 'error');

-- CreateTable
CREATE TABLE "public"."XCredential" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "accessTokenEnc" TEXT NOT NULL,
  "refreshTokenEnc" TEXT,
  "tokenType" TEXT,
  "scope" TEXT,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "XCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."XAccountSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "autoPostEnabled" BOOLEAN NOT NULL DEFAULT false,
  "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
  "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,
  "maxPostsPerDay" INTEGER NOT NULL DEFAULT 3,
  "maxAutoRepliesPerDay" INTEGER NOT NULL DEFAULT 60,
  "maxOutboundRepliesPerDay" INTEGER NOT NULL DEFAULT 10,
  "schedule" JSONB,
  "disclaimerText" TEXT,
  CONSTRAINT "XAccountSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."XActionLog" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actionType" "public"."XActionType" NOT NULL,
  "status" "public"."XActionStatus" NOT NULL DEFAULT 'success',
  "reason" TEXT,
  "meta" JSONB,
  "xId" TEXT,
  CONSTRAINT "XActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "XActionLog_createdAt_idx" ON "public"."XActionLog"("createdAt");

-- CreateIndex
CREATE INDEX "XActionLog_actionType_idx" ON "public"."XActionLog"("actionType");

-- CreateIndex
CREATE INDEX "XActionLog_status_idx" ON "public"."XActionLog"("status");

