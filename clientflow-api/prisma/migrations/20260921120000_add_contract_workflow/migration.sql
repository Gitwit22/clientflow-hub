CREATE TABLE "CfContractTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfContractTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CfContractTemplate_organizationId_name_key"
ON "CfContractTemplate"("organizationId", "name");

CREATE INDEX "CfContractTemplate_organizationId_isActive_idx"
ON "CfContractTemplate"("organizationId", "isActive");

ALTER TABLE "CfContract"
  ADD COLUMN "contractTemplateId" TEXT,
  ADD COLUMN "secureTokenHash" TEXT,
  ADD COLUMN "secureTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "CfCommunication"
  ADD COLUMN "contractId" TEXT;

WITH organizations AS (
  SELECT "id" AS "organizationId" FROM "Organization"
  UNION
  SELECT "organizationId" FROM "CfProgram"
  UNION
  SELECT "organizationId" FROM "CfContract"
), templates("name", "content") AS (
  VALUES
    ('Brand Awareness Service Agreement', 'BRAND AWARENESS SERVICE AGREEMENT\n\nPlaceholder scope and service terms for brand awareness services.\n\nTemplate draft only. Final legal language must be reviewed by the organization before use.'),
    ('Premier Workshop Service Agreement', 'PREMIER WORKSHOP SERVICE AGREEMENT\n\nPlaceholder scope and service terms for the 30-Day Premier Workshop.\n\nTemplate draft only. Final legal language must be reviewed by the organization before use.'),
    ('Event Planning Agreement', 'EVENT PLANNING AGREEMENT\n\nPlaceholder scope and service terms for event planning services.\n\nTemplate draft only. Final legal language must be reviewed by the organization before use.'),
    ('Commercial Property Service Agreement', 'COMMERCIAL PROPERTY SERVICE AGREEMENT\n\nPlaceholder scope and service terms for commercial property services.\n\nTemplate draft only. Final legal language must be reviewed by the organization before use.'),
    ('Grant Agreement', 'GRANT AGREEMENT\n\nPlaceholder scope and service terms for grant-related services.\n\nTemplate draft only. Final legal language must be reviewed by the organization before use.'),
    ('Sponsorship Agreement', 'SPONSORSHIP AGREEMENT\n\nPlaceholder scope and service terms for sponsorship services.\n\nTemplate draft only. Final legal language must be reviewed by the organization before use.'),
    ('General Services Agreement', 'GENERAL SERVICES AGREEMENT\n\nPlaceholder scope and service terms for general services.\n\nTemplate draft only. Final legal language must be reviewed by the organization before use.')
)
INSERT INTO "CfContractTemplate" (
  "id", "organizationId", "name", "content", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cftpl_' || md5(organizations."organizationId" || ':' || templates."name"),
  organizations."organizationId",
  templates."name",
  templates."content",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM organizations
CROSS JOIN templates
ON CONFLICT ("organizationId", "name") DO NOTHING;

UPDATE "CfContract" AS contract
SET "contractTemplateId" = template."id"
FROM "CfContractTemplate" AS template
WHERE template."organizationId" = contract."organizationId"
  AND template."name" = CASE
    WHEN contract."contractType" IN (
      'Brand Awareness Service Agreement',
      'Premier Workshop Service Agreement',
      'Event Planning Agreement',
      'Commercial Property Service Agreement',
      'Grant Agreement',
      'Sponsorship Agreement',
      'General Services Agreement'
    ) THEN contract."contractType"
    ELSE 'General Services Agreement'
  END;

UPDATE "CfContract"
SET
  "status" = CASE lower(trim("status"))
    WHEN 'draft' THEN 'DRAFT'
    WHEN 'sent' THEN 'SENT'
    WHEN 'opened' THEN 'OPENED'
    WHEN 'completed' THEN 'COMPLETED'
    WHEN 'signed' THEN 'COMPLETED'
    WHEN 'cancelled' THEN 'CANCELLED'
    WHEN 'canceled' THEN 'CANCELLED'
    WHEN 'expired' THEN 'EXPIRED'
    ELSE "status"
  END,
  "completedAt" = CASE
    WHEN lower(trim("status")) IN ('completed', 'signed') THEN "signedAt"
    ELSE "completedAt"
  END;

ALTER TABLE "CfContract"
  ALTER COLUMN "contractTemplateId" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE UNIQUE INDEX "CfContract_secureTokenHash_key"
ON "CfContract"("secureTokenHash");

CREATE INDEX "CfContract_organizationId_programId_idx"
ON "CfContract"("organizationId", "programId");

CREATE INDEX "CfContract_organizationId_contractTemplateId_idx"
ON "CfContract"("organizationId", "contractTemplateId");

CREATE INDEX "CfContract_organizationId_status_idx"
ON "CfContract"("organizationId", "status");

CREATE INDEX "CfCommunication_organizationId_contractId_idx"
ON "CfCommunication"("organizationId", "contractId");
