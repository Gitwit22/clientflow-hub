-- Program automation engine foundation: configurable rules, versioned program documents,
-- enrollment-scoped document assignments, and automation execution audit logs.
CREATE TYPE "CfProgramTrigger" AS ENUM (
  'intake_submitted',
  'enrollment_created',
  'enrollment_approved',
  'contract_signed',
  'form_completed',
  'document_uploaded',
  'program_completed'
);

CREATE TYPE "CfProgramAction" AS ENUM (
  'create_enrollment',
  'send_form',
  'send_contract',
  'send_email',
  'assign_document',
  'create_task',
  'change_status',
  'notify_staff'
);

CREATE TABLE "CfProgramAutomationRule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "trigger" "CfProgramTrigger" NOT NULL,
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "action" "CfProgramAction" NOT NULL,
  "actionConfig" JSONB NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramAutomationRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfProgramDocumentTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
  "autoSend" BOOLEAN NOT NULL DEFAULT false,
  "trigger" "CfProgramTrigger",
  "activeVersionId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramDocumentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfProgramDocumentVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileName" TEXT,
  "objectKey" TEXT,
  "bucket" TEXT,
  "byteSize" INTEGER,
  "checksum" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfProgramDocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfDocumentAssignment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "enrollmentId" TEXT,
  "programId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "templateVersionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "required" BOOLEAN NOT NULL DEFAULT true,
  "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
  "sentAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfDocumentAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfProgramAutomationExecution" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "enrollmentId" TEXT,
  "trigger" "CfProgramTrigger" NOT NULL,
  "action" "CfProgramAction" NOT NULL,
  "ruleId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "idempotencyKey" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfProgramAutomationExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CfProgramAutomationRule_organizationId_programId_trigger_enabled_sortOrder_idx"
  ON "CfProgramAutomationRule"("organizationId", "programId", "trigger", "enabled", "sortOrder");
CREATE INDEX "CfProgramAutomationRule_organizationId_idx"
  ON "CfProgramAutomationRule"("organizationId");

CREATE UNIQUE INDEX "CfProgramDocumentTemplate_organizationId_programId_name_key"
  ON "CfProgramDocumentTemplate"("organizationId", "programId", "name");
CREATE INDEX "CfProgramDocumentTemplate_organizationId_programId_isActive_idx"
  ON "CfProgramDocumentTemplate"("organizationId", "programId", "isActive");

CREATE UNIQUE INDEX "CfProgramDocumentVersion_templateId_version_key"
  ON "CfProgramDocumentVersion"("templateId", "version");
CREATE INDEX "CfProgramDocumentVersion_organizationId_templateId_uploadedAt_idx"
  ON "CfProgramDocumentVersion"("organizationId", "templateId", "uploadedAt");

CREATE UNIQUE INDEX "CfDocumentAssignment_enrollmentId_templateVersionId_key"
  ON "CfDocumentAssignment"("enrollmentId", "templateVersionId");
CREATE INDEX "CfDocumentAssignment_organizationId_programId_status_idx"
  ON "CfDocumentAssignment"("organizationId", "programId", "status");
CREATE INDEX "CfDocumentAssignment_organizationId_clientId_idx"
  ON "CfDocumentAssignment"("organizationId", "clientId");

CREATE UNIQUE INDEX "CfProgramAutomationExecution_organizationId_idempotencyKey_key"
  ON "CfProgramAutomationExecution"("organizationId", "idempotencyKey");
CREATE INDEX "CfProgramAutomationExecution_organizationId_programId_trigger_createdAt_idx"
  ON "CfProgramAutomationExecution"("organizationId", "programId", "trigger", "createdAt");
CREATE INDEX "CfProgramAutomationExecution_organizationId_clientId_createdAt_idx"
  ON "CfProgramAutomationExecution"("organizationId", "clientId", "createdAt");
