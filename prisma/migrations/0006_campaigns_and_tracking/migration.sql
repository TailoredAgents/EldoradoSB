-- CreateEnum
CREATE TYPE "public"."CampaignType" AS ENUM ('depositors', 'ambassadors', 'mixed');

-- CreateTable
CREATE TABLE "public"."Campaign" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."CampaignType" NOT NULL DEFAULT 'mixed',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TrackingLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "destinationUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "TrackingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClickEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referrer" TEXT,
    "userAgent" TEXT,
    "trackingLinkId" TEXT NOT NULL,

    CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_token_key" ON "public"."TrackingLink"("token");

-- CreateIndex
CREATE INDEX "TrackingLink_campaignId_idx" ON "public"."TrackingLink"("campaignId");

-- CreateIndex
CREATE INDEX "ClickEvent_trackingLinkId_idx" ON "public"."ClickEvent"("trackingLinkId");

-- CreateIndex
CREATE INDEX "ClickEvent_createdAt_idx" ON "public"."ClickEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."TrackingLink" ADD CONSTRAINT "TrackingLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClickEvent" ADD CONSTRAINT "ClickEvent_trackingLinkId_fkey" FOREIGN KEY ("trackingLinkId") REFERENCES "public"."TrackingLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

