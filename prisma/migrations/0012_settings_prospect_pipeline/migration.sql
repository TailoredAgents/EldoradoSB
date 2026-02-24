-- AlterTable
ALTER TABLE "public"."Settings"
ADD COLUMN "prospectPipelineEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "maxProspectPipelinePostReadsPerRun" INTEGER NOT NULL DEFAULT 15;

