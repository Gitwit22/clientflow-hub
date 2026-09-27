-- One-off catch-up script for the Neon SQL editor.
-- Applies migrations 20260924080000_add_cf_stored_file and
-- 20260924090000_backfill_program_contract_templates by hand (they were never applied by
-- Render's preDeployCommand) and records them in _prisma_migrations so future
-- `prisma migrate deploy` runs recognize them as already applied instead of erroring.
-- Every statement below is safe to re-run.

-- STEP 0 (optional): see what Prisma currently thinks is applied before you run anything else.
-- SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 10;

BEGIN;

-- ===== 20260924080000_add_cf_stored_file =====

CREATE TABLE IF NOT EXISTS "CfStoredFile" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "CfStoredFile_storageKey_key" ON "CfStoredFile"("storageKey");
CREATE INDEX IF NOT EXISTS "CfStoredFile_organizationId_idx" ON "CfStoredFile"("organizationId");
CREATE INDEX IF NOT EXISTS "CfStoredFile_organizationId_status_idx" ON "CfStoredFile"("organizationId", "status");

ALTER TABLE "CfProgramContractVersion" ADD COLUMN IF NOT EXISTS "storedFileId" TEXT;
ALTER TABLE "CfProgramWelcomeEmailVersion" ADD COLUMN IF NOT EXISTS "guideStoredFileId" TEXT;
ALTER TABLE "CfContract" ADD COLUMN IF NOT EXISTS "executedStoredFileId" TEXT;
ALTER TABLE "CfDocument" ADD COLUMN IF NOT EXISTS "storedFileId" TEXT;

CREATE INDEX IF NOT EXISTS "CfProgramContractVersion_storedFileId_idx" ON "CfProgramContractVersion"("storedFileId");
CREATE INDEX IF NOT EXISTS "CfProgramWelcomeEmailVersion_guideStoredFileId_idx" ON "CfProgramWelcomeEmailVersion"("guideStoredFileId");
CREATE INDEX IF NOT EXISTS "CfContract_executedStoredFileId_idx" ON "CfContract"("executedStoredFileId");
CREATE INDEX IF NOT EXISTS "CfDocument_storedFileId_idx" ON "CfDocument"("storedFileId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CfProgramContractVersion_storedFileId_fkey') THEN
    ALTER TABLE "CfProgramContractVersion"
      ADD CONSTRAINT "CfProgramContractVersion_storedFileId_fkey"
      FOREIGN KEY ("storedFileId") REFERENCES "CfStoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CfProgramWelcomeEmailVersion_guideStoredFileId_fkey') THEN
    ALTER TABLE "CfProgramWelcomeEmailVersion"
      ADD CONSTRAINT "CfProgramWelcomeEmailVersion_guideStoredFileId_fkey"
      FOREIGN KEY ("guideStoredFileId") REFERENCES "CfStoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CfContract_executedStoredFileId_fkey') THEN
    ALTER TABLE "CfContract"
      ADD CONSTRAINT "CfContract_executedStoredFileId_fkey"
      FOREIGN KEY ("executedStoredFileId") REFERENCES "CfStoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CfDocument_storedFileId_fkey') THEN
    ALTER TABLE "CfDocument"
      ADD CONSTRAINT "CfDocument_storedFileId_fkey"
      FOREIGN KEY ("storedFileId") REFERENCES "CfStoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid()::text, '90ef463627e599da9aa1ebed2ab9199888d65fe472d4f5e5df96074848112931',
  '20260924080000_add_cf_stored_file', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260924080000_add_cf_stored_file'
);

-- ===== 20260924090000_backfill_program_contract_templates =====
-- (Idempotent as-authored: ON CONFLICT DO NOTHING / COALESCE-only updates.)

WITH program_template_name("programName", "templateName") AS (
  VALUES
    ('Brand Awareness Subscription', 'Brand Awareness Service Agreement'),
    ('30-Day Premier Workshop Subscription', 'Premier Workshop Service Agreement'),
    ('Event Planning', 'Event Planning Agreement'),
    ('Commercial Property', 'Commercial Property Service Agreement'),
    ('Grant', 'Grant Agreement'),
    ('Sponsorship', 'Sponsorship Agreement'),
    ('Interest', 'General Services Agreement'),
    ('Other / Unsure', 'General Services Agreement'),
    ('The Inspired Detroit Initiative', 'IDI Membership Agreement'),
    ('Inspire Detroit Initiative', 'IDI Membership Agreement')
), resolved AS (
  SELECT DISTINCT ON (program."id")
    program."id" AS "programId",
    program."organizationId" AS "organizationId",
    program."name" AS "programName",
    legacy."name" AS "legacyTemplateName",
    legacy."content" AS "legacyTemplateContent"
  FROM "CfProgram" program
  JOIN "CfContractTemplate" legacy
    ON legacy."organizationId" = program."organizationId"
    AND legacy."isActive" = true
    AND (
      legacy."id" = program."defaultContractTemplateId"
      OR legacy."name" = program."defaultContractTemplateId"
      OR legacy."name" = (SELECT "templateName" FROM program_template_name WHERE "programName" = program."name")
    )
  WHERE program."isActive" = true
  ORDER BY program."id", (legacy."id" = program."defaultContractTemplateId") DESC, legacy."updatedAt" DESC
)
INSERT INTO "CfProgramContractTemplate" (
  "id", "organizationId", "programId", "name", "signatureRequired", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cfpct_' || md5(resolved."programId" || ':' || resolved."legacyTemplateName"),
  resolved."organizationId",
  resolved."programId",
  resolved."legacyTemplateName",
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM resolved
ON CONFLICT ("organizationId", "programId", "name") DO NOTHING;

WITH program_template_name("programName", "templateName") AS (
  VALUES
    ('Brand Awareness Subscription', 'Brand Awareness Service Agreement'),
    ('30-Day Premier Workshop Subscription', 'Premier Workshop Service Agreement'),
    ('Event Planning', 'Event Planning Agreement'),
    ('Commercial Property', 'Commercial Property Service Agreement'),
    ('Grant', 'Grant Agreement'),
    ('Sponsorship', 'Sponsorship Agreement'),
    ('Interest', 'General Services Agreement'),
    ('Other / Unsure', 'General Services Agreement'),
    ('The Inspired Detroit Initiative', 'IDI Membership Agreement'),
    ('Inspire Detroit Initiative', 'IDI Membership Agreement')
), resolved AS (
  SELECT DISTINCT ON (program."id")
    program."id" AS "programId",
    program."organizationId" AS "organizationId",
    legacy."name" AS "legacyTemplateName",
    legacy."content" AS "legacyTemplateContent"
  FROM "CfProgram" program
  JOIN "CfContractTemplate" legacy
    ON legacy."organizationId" = program."organizationId"
    AND legacy."isActive" = true
    AND (
      legacy."id" = program."defaultContractTemplateId"
      OR legacy."name" = program."defaultContractTemplateId"
      OR legacy."name" = (SELECT "templateName" FROM program_template_name WHERE "programName" = program."name")
    )
  WHERE program."isActive" = true
  ORDER BY program."id", (legacy."id" = program."defaultContractTemplateId") DESC, legacy."updatedAt" DESC
)
INSERT INTO "CfProgramContractVersion" (
  "id", "organizationId", "templateId", "version", "title", "content", "signableFields", "createdBy", "createdAt"
)
SELECT
  'cfpcv_' || md5(resolved."programId" || ':' || resolved."legacyTemplateName" || ':1'),
  resolved."organizationId",
  'cfpct_' || md5(resolved."programId" || ':' || resolved."legacyTemplateName"),
  1,
  resolved."legacyTemplateName",
  resolved."legacyTemplateContent",
  '[]',
  'system_backfill',
  CURRENT_TIMESTAMP
FROM resolved
ON CONFLICT ("templateId", "version") DO NOTHING;

WITH program_template_name("programName", "templateName") AS (
  VALUES
    ('Brand Awareness Subscription', 'Brand Awareness Service Agreement'),
    ('30-Day Premier Workshop Subscription', 'Premier Workshop Service Agreement'),
    ('Event Planning', 'Event Planning Agreement'),
    ('Commercial Property', 'Commercial Property Service Agreement'),
    ('Grant', 'Grant Agreement'),
    ('Sponsorship', 'Sponsorship Agreement'),
    ('Interest', 'General Services Agreement'),
    ('Other / Unsure', 'General Services Agreement'),
    ('The Inspired Detroit Initiative', 'IDI Membership Agreement'),
    ('Inspire Detroit Initiative', 'IDI Membership Agreement')
), resolved AS (
  SELECT DISTINCT ON (program."id")
    program."id" AS "programId",
    program."organizationId" AS "organizationId",
    program."name" AS "programName",
    legacy."name" AS "legacyTemplateName"
  FROM "CfProgram" program
  JOIN "CfContractTemplate" legacy
    ON legacy."organizationId" = program."organizationId"
    AND legacy."isActive" = true
    AND (
      legacy."id" = program."defaultContractTemplateId"
      OR legacy."name" = program."defaultContractTemplateId"
      OR legacy."name" = (SELECT "templateName" FROM program_template_name WHERE "programName" = program."name")
    )
  WHERE program."isActive" = true
  ORDER BY program."id", (legacy."id" = program."defaultContractTemplateId") DESC, legacy."updatedAt" DESC
)
INSERT INTO "CfProgramWorkflowConfig" (
  "id", "organizationId", "programId", "enabled", "sendContractAfterIntake",
  "sendWelcomeAfterContractSigned", "activeContractTemplateId", "activeContractVersionId",
  "createdAt", "updatedAt"
)
SELECT
  'cfpwc_' || md5(resolved."programId"),
  resolved."organizationId",
  resolved."programId",
  true,
  resolved."programName" IN (
    'Brand Awareness Subscription',
    '30-Day Premier Workshop Subscription',
    'The Inspired Detroit Initiative',
    'Inspire Detroit Initiative'
  ),
  true,
  'cfpct_' || md5(resolved."programId" || ':' || resolved."legacyTemplateName"),
  'cfpcv_' || md5(resolved."programId" || ':' || resolved."legacyTemplateName" || ':1'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM resolved
ON CONFLICT ("organizationId", "programId") DO UPDATE SET
  "activeContractTemplateId" = COALESCE("CfProgramWorkflowConfig"."activeContractTemplateId", EXCLUDED."activeContractTemplateId"),
  "activeContractVersionId" = COALESCE("CfProgramWorkflowConfig"."activeContractVersionId", EXCLUDED."activeContractVersionId"),
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid()::text, '28ca63515f4c8be13ae817d110ba244c3cd2d545df2ac13ddf7eca165cb2a6b8',
  '20260924090000_backfill_program_contract_templates', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260924090000_backfill_program_contract_templates'
);

COMMIT;

-- Verify afterwards:
-- SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 5;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'CfContract' AND column_name = 'executedStoredFileId';
