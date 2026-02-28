-- CreateEnum
CREATE TYPE "public"."ConversationOutcomeTag" AS ENUM ('no_response', 'asked_fee', 'declined', 'deposit_confirmed', 'ambassador_interested', 'support_needed', 'do_not_contact', 'other');

-- CreateTable
CREATE TABLE "public"."ConversationOutcome" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "userId" TEXT,
    "tag" "public"."ConversationOutcomeTag" NOT NULL,
    "depositors" INTEGER,
    "depositsUsd" DOUBLE PRECISION,
    "notes" TEXT,
    "trackingLinkId" TEXT,
    "meta" JSONB,

    CONSTRAINT "ConversationOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExternalUser" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handle" TEXT,
    "name" TEXT,
    "meta" JSONB,

    CONSTRAINT "ExternalUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationOutcome_platform_threadKey_createdAt_idx" ON "public"."ConversationOutcome"("platform", "threadKey", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationOutcome_platform_tag_createdAt_idx" ON "public"."ConversationOutcome"("platform", "tag", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationOutcome_platform_userId_createdAt_idx" ON "public"."ConversationOutcome"("platform", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationOutcome_trackingLinkId_idx" ON "public"."ConversationOutcome"("trackingLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalUser_platform_userId_key" ON "public"."ExternalUser"("platform", "userId");

-- CreateIndex
CREATE INDEX "ExternalUser_platform_handle_idx" ON "public"."ExternalUser"("platform", "handle");

-- AddForeignKey
ALTER TABLE "public"."ConversationOutcome" ADD CONSTRAINT "ConversationOutcome_trackingLinkId_fkey" FOREIGN KEY ("trackingLinkId") REFERENCES "public"."TrackingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

