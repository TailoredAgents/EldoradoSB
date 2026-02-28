-- CreateTable
CREATE TABLE "public"."ConversationMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "userId" TEXT,
    "text" TEXT NOT NULL,
    "meta" JSONB,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationMessage_createdAt_idx" ON "public"."ConversationMessage"("createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_platform_threadKey_createdAt_idx" ON "public"."ConversationMessage"("platform", "threadKey", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_platform_userId_createdAt_idx" ON "public"."ConversationMessage"("platform", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_platform_externalId_key" ON "public"."ConversationMessage"("platform", "externalId");

