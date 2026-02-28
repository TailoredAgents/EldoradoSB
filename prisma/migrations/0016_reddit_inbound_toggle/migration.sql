-- AlterTable
ALTER TABLE "public"."RedditAccountSettings"
ADD COLUMN "inboundEnabled" BOOLEAN NOT NULL DEFAULT false;

