-- AlterTable
ALTER TABLE "public"."Prospect"
ADD COLUMN "lastSampledAt" TIMESTAMP(3),
ADD COLUMN "lastAnalyzedAt" TIMESTAMP(3);

