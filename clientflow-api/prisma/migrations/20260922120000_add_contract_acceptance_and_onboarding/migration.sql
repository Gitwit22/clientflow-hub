ALTER TABLE "CfContract"
  ADD COLUMN "signedName" TEXT,
  ADD COLUMN "signedEmail" TEXT,
  ADD COLUMN "agreedToTerms" BOOLEAN,
  ADD COLUMN "signatureNote" TEXT,
  ADD COLUMN "signerIp" TEXT,
  ADD COLUMN "signerUserAgent" TEXT;

CREATE TABLE "CfMonitoringTask" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "assignedStaffId" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfMonitoringTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CfMonitoringTask_status_check"
    CHECK ("status" IN ('PENDING', 'COMPLETED', 'OVERDUE', 'CANCELLED'))
);

CREATE UNIQUE INDEX "CfMonitoringTask_contractId_key"
ON "CfMonitoringTask"("contractId");

CREATE INDEX "CfMonitoringTask_organizationId_clientId_idx"
ON "CfMonitoringTask"("organizationId", "clientId");

CREATE INDEX "CfMonitoringTask_organizationId_programId_status_idx"
ON "CfMonitoringTask"("organizationId", "programId", "status");

CREATE INDEX "CfMonitoringTask_dueDate_idx"
ON "CfMonitoringTask"("dueDate");