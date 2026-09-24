CREATE TABLE "CfStoredFile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "uploadedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CfStoredFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CfStoredFile_storageKey_key" ON "CfStoredFile"("storageKey");
CREATE INDEX "CfStoredFile_organizationId_idx" ON "CfStoredFile"("organizationId");
CREATE INDEX "CfStoredFile_organizationId_status_idx" ON "CfStoredFile"("organizationId", "status");

ALTER TABLE "CfProgramContractVersion" ADD COLUMN IF NOT EXISTS "storedFileId" TEXT;
ALTER TABLE "CfProgramWelcomeEmailVersion" ADD COLUMN IF NOT EXISTS "guideStoredFileId" TEXT;
ALTER TABLE "CfContract" ADD COLUMN IF NOT EXISTS "executedStoredFileId" TEXT;
ALTER TABLE "CfDocument" ADD COLUMN IF NOT EXISTS "storedFileId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CfProgramContractVersion_storedFileId_key" ON "CfProgramContractVersion"("storedFileId");
CREATE UNIQUE INDEX IF NOT EXISTS "CfProgramWelcomeEmailVersion_guideStoredFileId_key" ON "CfProgramWelcomeEmailVersion"("guideStoredFileId");
CREATE UNIQUE INDEX IF NOT EXISTS "CfContract_executedStoredFileId_key" ON "CfContract"("executedStoredFileId");
CREATE UNIQUE INDEX IF NOT EXISTS "CfDocument_storedFileId_key" ON "CfDocument"("storedFileId");

ALTER TABLE "CfProgramContractVersion"
  ADD CONSTRAINT "CfProgramContractVersion_storedFileId_fkey"
  FOREIGN KEY ("storedFileId") REFERENCES "CfStoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CfProgramWelcomeEmailVersion"
  ADD CONSTRAINT "CfProgramWelcomeEmailVersion_guideStoredFileId_fkey"
  FOREIGN KEY ("guideStoredFileId") REFERENCES "CfStoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CfContract"
  ADD CONSTRAINT "CfContract_executedStoredFileId_fkey"
  FOREIGN KEY ("executedStoredFileId") REFERENCES "CfStoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CfDocument"
  ADD CONSTRAINT "CfDocument_storedFileId_fkey"
  FOREIGN KEY ("storedFileId") REFERENCES "CfStoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
