-- Regression fix: ContractsService.resolveTemplate no longer falls back to the legacy
-- org-scoped CfContractTemplate (by design - a program with no active version must never
-- auto-send the wrong agreement). That removed the only source of contract content for every
-- existing program, since nothing had ever populated CfProgramWorkflowConfig.activeContractTemplateId.
-- This backfill promotes each program's existing legacy template into the real
-- CfProgramContractTemplate/Version system and activates it, restoring auto-send for programs that
-- already had a legacy template without touching programs that didn't (those correctly continue to
-- stop and flag CONTRACT_CONFIGURATION_MISSING).

-- Resolve one legacy template per program, mirroring every match strategy the old
-- resolveTemplate() fallback used: defaultContractTemplateId as a real template id, as a template
-- name, or the PROGRAM_CONTRACT_TEMPLATES name mapped from the program's display name.
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

-- sendContractAfterIntake mirrors the legacy PROGRAM_CONTRACT_RULES classification so newly
-- created workflow config rows keep the same auto-send/staff-review behavior as before. Existing
-- rows are only patched where the active template/version is still unset, never overwriting a
-- toggle an admin may have already changed.
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
