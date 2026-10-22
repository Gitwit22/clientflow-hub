-- Program-wide emails. Additive only.

-- AlterTable
ALTER TABLE "CfCommunication" ADD COLUMN "programEmailId" TEXT;

-- CreateTable
CREATE TABLE "CfProgramEmail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentByUserId" TEXT,
    "sentByDisplayName" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "recipientCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "skipped" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CfProgramEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CfCommunication_programEmailId_status_idx" ON "CfCommunication"("programEmailId", "status");

-- CreateIndex
CREATE INDEX "CfProgramEmail_organizationId_programId_createdAt_idx" ON "CfProgramEmail"("organizationId", "programId", "createdAt");

-- CreateIndex
CREATE INDEX "CfProgramEmail_status_idx" ON "CfProgramEmail"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CfProgramEmail_organizationId_idempotencyKey_key" ON "CfProgramEmail"("organizationId", "idempotencyKey");
