-- AlterTable
ALTER TABLE "public"."Prospect"
ADD COLUMN "firstDiscoveredAt" TIMESTAMP(3),
ADD COLUMN "firstDiscoveredQueryId" TEXT;

-- AlterTable
ALTER TABLE "public"."OutreachEvent"
ADD COLUMN "depositors" INTEGER,
ADD COLUMN "depositsUsd" DOUBLE PRECISION;

