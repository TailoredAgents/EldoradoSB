-- AlterTable
ALTER TABLE "public"."XAccountSettings"
ADD COLUMN "maxOutboundRepliesPerRun" INTEGER NOT NULL DEFAULT 10;

