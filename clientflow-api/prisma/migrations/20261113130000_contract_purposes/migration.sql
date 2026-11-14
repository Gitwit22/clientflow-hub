-- Agreement purposes: a program can have several named agreement templates, one of them its
-- enrollment agreement, others generated per funding award. Additive only; every existing template
-- and contract is an enrollment agreement, which is today's behavior.

-- AlterTable
ALTER TABLE "CfProgramContractTemplate" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'enrollment';
ALTER TABLE "CfProgramContractTemplate" ADD COLUMN "activeVersionId" TEXT;

-- AlterTable
ALTER TABLE "CfContract" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'enrollment';
ALTER TABLE "CfContract" ADD COLUMN "programTemplateId" TEXT;
ALTER TABLE "CfContract" ADD COLUMN "renderedFromVersionId" TEXT;

-- Each template's active version starts as the one the program workflow already uses.
UPDATE "CfProgramContractTemplate" AS t
SET "activeVersionId" = w."activeContractVersionId"
FROM "CfProgramWorkflowConfig" AS w
WHERE w."organizationId" = t."organizationId"
  AND w."programId" = t."programId"
  AND w."activeContractTemplateId" = t."id"
  AND w."activeContractVersionId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "CfContract_organizationId_clientId_purpose_idx" ON "CfContract"("organizationId", "clientId", "purpose");
