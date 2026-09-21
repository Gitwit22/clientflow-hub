ALTER TABLE "CfProgramEnrollment"
ADD COLUMN IF NOT EXISTS "lastModifiedByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "lastModifiedByDisplayName" TEXT;

ALTER TABLE "CfEnrollmentStatusHistory"
ADD COLUMN IF NOT EXISTS "changedByDisplayName" TEXT;

CREATE INDEX IF NOT EXISTS "CfProgramEnrollment_organizationId_lastModifiedByUserId_idx"
ON "CfProgramEnrollment"("organizationId", "lastModifiedByUserId");