CREATE TABLE "CfProgramWorkflowConfig" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sendContractAfterIntake" BOOLEAN NOT NULL DEFAULT false,
  "sendWelcomeAfterContractSigned" BOOLEAN NOT NULL DEFAULT false,
  "activeContractTemplateId" TEXT,
  "activeContractVersionId" TEXT,
  "activeWelcomeEmailTemplateId" TEXT,
  "activeWelcomeEmailVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramWorkflowConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CfProgramWorkflowConfig_programId_key" ON "CfProgramWorkflowConfig"("programId");
CREATE INDEX "CfProgramWorkflowConfig_organizationId_programId_idx" ON "CfProgramWorkflowConfig"("organizationId", "programId");

CREATE TABLE "CfProgramContractTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "signatureRequired" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramContractTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CfProgramContractTemplate_organizationId_programId_name_key" ON "CfProgramContractTemplate"("organizationId", "programId", "name");
CREATE INDEX "CfProgramContractTemplate_organizationId_programId_isActive_idx" ON "CfProgramContractTemplate"("organizationId", "programId", "isActive");

CREATE TABLE "CfProgramContractVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT,
  "content" TEXT NOT NULL,
  "fileUrl" TEXT,
  "fileName" TEXT,
  "signableFields" JSONB NOT NULL DEFAULT '[]',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfProgramContractVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CfProgramContractVersion_templateId_version_key" ON "CfProgramContractVersion"("templateId", "version");
CREATE INDEX "CfProgramContractVersion_organizationId_templateId_createdAt_idx" ON "CfProgramContractVersion"("organizationId", "templateId", "createdAt");

CREATE TABLE "CfProgramWelcomeEmailTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramWelcomeEmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CfProgramWelcomeEmailTemplate_organizationId_programId_name_key" ON "CfProgramWelcomeEmailTemplate"("organizationId", "programId", "name");
CREATE INDEX "CfProgramWelcomeEmailTemplate_organizationId_programId_isActive_idx" ON "CfProgramWelcomeEmailTemplate"("organizationId", "programId", "isActive");

CREATE TABLE "CfProgramWelcomeEmailVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "allowedVariables" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfProgramWelcomeEmailVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CfProgramWelcomeEmailVersion_templateId_version_key" ON "CfProgramWelcomeEmailVersion"("templateId", "version");
CREATE INDEX "CfProgramWelcomeEmailVersion_organizationId_templateId_createdAt_idx" ON "CfProgramWelcomeEmailVersion"("organizationId", "templateId", "createdAt");

ALTER TABLE "CfCommunication"
  ADD COLUMN "renderedSubject" TEXT,
  ADD COLUMN "renderedBody" TEXT,
  ADD COLUMN "templateContext" JSONB;
