-- AlterTable
ALTER TABLE "public"."Prospect"
ADD COLUMN "primarySport" TEXT,
ADD COLUMN "queuedAt" TIMESTAMP(3),
ADD COLUMN "queuedDay" TIMESTAMP(3),
ADD COLUMN "dmDraft" TEXT,
ADD COLUMN "emailSubject" TEXT,
ADD COLUMN "emailBody" TEXT,
ADD COLUMN "draftedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Prospect_queuedDay_idx" ON "public"."Prospect"("queuedDay");

-- CreateIndex
CREATE INDEX "Prospect_primarySport_idx" ON "public"."Prospect"("primarySport");

