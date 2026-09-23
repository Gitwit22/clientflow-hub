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

CREATE UNIQUE INDEX "CfProgramWorkflowConfig_organizationId_programId_key" ON "CfProgramWorkflowConfig"("organizationId", "programId");
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

ALTER TABLE "CfProgramWorkflowConfig"
  ADD CONSTRAINT "CfProgramWorkflowConfig_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "CfProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CfProgramWorkflowConfig"
  ADD CONSTRAINT "CfProgramWorkflowConfig_activeContractTemplateId_fkey"
  FOREIGN KEY ("activeContractTemplateId") REFERENCES "CfProgramContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CfProgramWorkflowConfig"
  ADD CONSTRAINT "CfProgramWorkflowConfig_activeContractVersionId_fkey"
  FOREIGN KEY ("activeContractVersionId") REFERENCES "CfProgramContractVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CfProgramWorkflowConfig"
  ADD CONSTRAINT "CfProgramWorkflowConfig_activeWelcomeEmailTemplateId_fkey"
  FOREIGN KEY ("activeWelcomeEmailTemplateId") REFERENCES "CfProgramWelcomeEmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CfProgramWorkflowConfig"
  ADD CONSTRAINT "CfProgramWorkflowConfig_activeWelcomeEmailVersionId_fkey"
  FOREIGN KEY ("activeWelcomeEmailVersionId") REFERENCES "CfProgramWelcomeEmailVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CfProgramContractTemplate"
  ADD CONSTRAINT "CfProgramContractTemplate_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "CfProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CfProgramContractVersion"
  ADD CONSTRAINT "CfProgramContractVersion_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "CfProgramContractTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CfProgramWelcomeEmailTemplate"
  ADD CONSTRAINT "CfProgramWelcomeEmailTemplate_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "CfProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CfProgramWelcomeEmailVersion"
  ADD CONSTRAINT "CfProgramWelcomeEmailVersion_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "CfProgramWelcomeEmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
