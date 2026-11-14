-- Copying one program's setup into another (agreements, welcome email, deliverables, ...): one row
-- per copy, as the audit trail and so a repeated request (double click, retry) with the same key
-- returns the first copy instead of copying twice. Additive only.

-- CreateTable
CREATE TABLE "CfProgramSetupCopy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetProgramId" TEXT NOT NULL,
    "sourceProgramId" TEXT NOT NULL,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB NOT NULL DEFAULT '[]',
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdByDisplayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CfProgramSetupCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CfProgramSetupCopy_organizationId_idempotencyKey_key" ON "CfProgramSetupCopy"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CfProgramSetupCopy_organizationId_targetProgramId_idx" ON "CfProgramSetupCopy"("organizationId", "targetProgramId");
