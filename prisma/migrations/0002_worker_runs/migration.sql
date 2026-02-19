-- CreateEnum
CREATE TYPE "public"."WorkerRunStatus" AS ENUM (
  'started',
  'skipped_disabled',
  'skipped_budget',
  'success',
  'error'
);

-- CreateTable
CREATE TABLE "public"."WorkerRun" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "status" "public"."WorkerRunStatus" NOT NULL DEFAULT 'started',
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "xPostReadsDelta" INTEGER NOT NULL DEFAULT 0,
  "xUserLookupsDelta" INTEGER NOT NULL DEFAULT 0,
  "stats" JSONB,
  "errorMessage" TEXT,
  CONSTRAINT "WorkerRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerRun_startedAt_idx" ON "public"."WorkerRun"("startedAt");

-- CreateIndex
CREATE INDEX "WorkerRun_status_idx" ON "public"."WorkerRun"("status");

