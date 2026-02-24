-- AlterTable
ALTER TABLE "public"."XAccountSettings"
ADD COLUMN "linkTokenDefault" TEXT,
ADD COLUMN "linkTokenPayout" TEXT,
ADD COLUMN "linkTokenPicks" TEXT,
ADD COLUMN "linkTokenGen" TEXT;

-- CreateTable
CREATE TABLE "public"."WeeklyDepositResult" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "tier" TEXT,
    "campaignId" TEXT,
    "depositors" INTEGER NOT NULL DEFAULT 0,
    "depositsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "WeeklyDepositResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyDepositResult_weekStart_idx" ON "public"."WeeklyDepositResult"("weekStart");

-- CreateIndex
CREATE INDEX "WeeklyDepositResult_tier_idx" ON "public"."WeeklyDepositResult"("tier");

-- CreateIndex
CREATE INDEX "WeeklyDepositResult_campaignId_idx" ON "public"."WeeklyDepositResult"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyDepositResult_weekStart_tier_campaignId_key" ON "public"."WeeklyDepositResult"("weekStart", "tier", "campaignId");

-- AddForeignKey
ALTER TABLE "public"."WeeklyDepositResult" ADD CONSTRAINT "WeeklyDepositResult_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

