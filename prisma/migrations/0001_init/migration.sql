-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."ProspectStatus" AS ENUM ('new', 'queued', 'contacted', 'replied', 'negotiating', 'signed', 'rejected', 'dnc', 'done');

-- CreateEnum
CREATE TYPE "public"."OutreachChannel" AS ENUM ('dm', 'email');

-- CreateTable
CREATE TABLE "public"."Prospect" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "xUserId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT,
    "bio" TEXT,
    "url" TEXT,
    "location" TEXT,
    "followers" INTEGER,
    "verified" BOOLEAN,
    "status" "public"."ProspectStatus" NOT NULL DEFAULT 'new',
    "owner" TEXT,
    "usFocusConfidence" DOUBLE PRECISION,
    "performanceScore" DOUBLE PRECISION,
    "acceptanceScore" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION,
    "tier" TEXT,
    "rationale" JSONB,
    "notes" TEXT,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PostSample" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "text" TEXT NOT NULL,
    "permalink" TEXT,
    "likes" INTEGER,
    "replies" INTEGER,
    "reposts" INTEGER,
    "quotes" INTEGER,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prospectId" TEXT NOT NULL,

    CONSTRAINT "PostSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScoreHistory" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputsHash" TEXT NOT NULL,
    "features" JSONB,
    "performanceScore" DOUBLE PRECISION,
    "acceptanceScore" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION,
    "tier" TEXT,
    "rationale" JSONB,
    "prospectId" TEXT NOT NULL,

    CONSTRAINT "ScoreHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OutreachEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" "public"."OutreachChannel" NOT NULL,
    "eventType" TEXT NOT NULL,
    "templateUsed" TEXT,
    "outcome" TEXT,
    "followUpAt" TIMESTAMP(3),
    "notes" TEXT,
    "prospectId" TEXT NOT NULL,

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxPostReadsPerRun" INTEGER NOT NULL DEFAULT 25,
    "maxPostReadsPerDay" INTEGER NOT NULL DEFAULT 400,
    "queueValueCount" INTEGER NOT NULL DEFAULT 12,
    "queueAcceptanceCount" INTEGER NOT NULL DEFAULT 6,
    "queueExplorationCount" INTEGER NOT NULL DEFAULT 2,
    "disclaimerText" TEXT,
    "templates" JSONB,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UsageLedger" (
    "date" TIMESTAMP(3) NOT NULL,
    "xPostReads" INTEGER NOT NULL DEFAULT 0,
    "xUserLookups" INTEGER NOT NULL DEFAULT 0,
    "llmTokensByModel" JSONB,
    "estimatedCostUsd" DOUBLE PRECISION,

    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_xUserId_key" ON "public"."Prospect"("xUserId");

-- CreateIndex
CREATE INDEX "Prospect_status_idx" ON "public"."Prospect"("status");

-- CreateIndex
CREATE INDEX "Prospect_tier_idx" ON "public"."Prospect"("tier");

-- CreateIndex
CREATE INDEX "Prospect_owner_idx" ON "public"."Prospect"("owner");

-- CreateIndex
CREATE INDEX "Prospect_followers_idx" ON "public"."Prospect"("followers");

-- CreateIndex
CREATE INDEX "Prospect_overallScore_idx" ON "public"."Prospect"("overallScore");

-- CreateIndex
CREATE UNIQUE INDEX "PostSample_postId_key" ON "public"."PostSample"("postId");

-- CreateIndex
CREATE INDEX "PostSample_prospectId_idx" ON "public"."PostSample"("prospectId");

-- CreateIndex
CREATE INDEX "PostSample_sampledAt_idx" ON "public"."PostSample"("sampledAt");

-- CreateIndex
CREATE INDEX "ScoreHistory_computedAt_idx" ON "public"."ScoreHistory"("computedAt");

-- CreateIndex
CREATE INDEX "ScoreHistory_tier_idx" ON "public"."ScoreHistory"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreHistory_prospectId_inputsHash_key" ON "public"."ScoreHistory"("prospectId", "inputsHash");

-- CreateIndex
CREATE INDEX "OutreachEvent_prospectId_idx" ON "public"."OutreachEvent"("prospectId");

-- CreateIndex
CREATE INDEX "OutreachEvent_eventAt_idx" ON "public"."OutreachEvent"("eventAt");

-- CreateIndex
CREATE INDEX "OutreachEvent_channel_idx" ON "public"."OutreachEvent"("channel");

-- AddForeignKey
ALTER TABLE "public"."PostSample" ADD CONSTRAINT "PostSample_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "public"."Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ScoreHistory" ADD CONSTRAINT "ScoreHistory_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "public"."Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OutreachEvent" ADD CONSTRAINT "OutreachEvent_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "public"."Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
