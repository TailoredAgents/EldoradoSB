-- Add Reddit outbound guardrails (auto backoff + thresholds).
ALTER TABLE "public"."RedditAccountSettings"
  ADD COLUMN "autoBackoffEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "maxErrorsPerDay" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "maxRemovalsPerDay" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "backoffUntil" TIMESTAMP(3);

