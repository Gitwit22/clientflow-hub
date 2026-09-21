WITH target AS (
  SELECT "id", "organizationId", COALESCE(
    NULLIF(TRIM(CONCAT_WS(' ', "firstName", "lastName")), ''),
    "email"
  ) AS "displayName"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfClient" AS record
SET "assignedUserId" = target."id", "assignedStaff" = target."displayName"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND (
    record."assignedUserId" = 'user_alicia'
    OR LOWER(TRIM(record."assignedStaff")) IN ('alicia monroe', 'aliciaan monroe')
  );

WITH target AS (
  SELECT "id", "organizationId", COALESCE(
    NULLIF(TRIM(CONCAT_WS(' ', "firstName", "lastName")), ''),
    "email"
  ) AS "displayName"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfProgramEnrollment" AS record
SET "assignedUserId" = target."id", "assignedStaff" = target."displayName"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND (
    record."assignedUserId" = 'user_alicia'
    OR LOWER(TRIM(record."assignedStaff")) IN ('alicia monroe', 'aliciaan monroe')
  );

WITH target AS (
  SELECT "id", "organizationId", COALESCE(
    NULLIF(TRIM(CONCAT_WS(' ', "firstName", "lastName")), ''),
    "email"
  ) AS "displayName"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfTask" AS record
SET "assignedUserId" = target."id", "assignedStaff" = target."displayName"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND (
    record."assignedUserId" = 'user_alicia'
    OR LOWER(TRIM(record."assignedStaff")) IN ('alicia monroe', 'aliciaan monroe')
  );

WITH target AS (
  SELECT "id", "organizationId"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfFormAssignment" AS record
SET "assignedUserId" = target."id"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND record."assignedUserId" = 'user_alicia';

WITH target AS (
  SELECT "id", "organizationId"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfFormAssignment" AS record
SET "createdByUserId" = target."id"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND record."createdByUserId" = 'user_alicia';

WITH target AS (
  SELECT "id", "organizationId", COALESCE(
    NULLIF(TRIM(CONCAT_WS(' ', "firstName", "lastName")), ''),
    "email"
  ) AS "displayName"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfActivityLog" AS record
SET "actorUserId" = target."id", "user" = target."displayName"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND (
    record."actorUserId" = 'user_alicia'
    OR LOWER(TRIM(record."user")) IN ('alicia monroe', 'aliciaan monroe')
  );

WITH target AS (
  SELECT "id", "organizationId", COALESCE(
    NULLIF(TRIM(CONCAT_WS(' ', "firstName", "lastName")), ''),
    "email"
  ) AS "displayName"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfEnrollmentStatusHistory" AS record
SET "changedByUserId" = target."id", "changedByDisplayName" = target."displayName"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND (
    record."changedByUserId" = 'user_alicia'
    OR LOWER(TRIM(record."changedByDisplayName")) IN ('alicia monroe', 'aliciaan monroe')
  );

WITH target AS (
  SELECT "id", "organizationId"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfProgramProgressTemplateVersion" AS record
SET "publishedByUserId" = target."id"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND record."publishedByUserId" = 'user_alicia';

WITH target AS (
  SELECT "id", "organizationId"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfProgramMonitoringTemplateVersion" AS record
SET "publishedByUserId" = target."id"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND record."publishedByUserId" = 'user_alicia';

WITH target AS (
  SELECT "id", "organizationId"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfEnrollmentProgressPlan" AS record
SET "replacedByUserId" = target."id"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND record."replacedByUserId" = 'user_alicia';

WITH target AS (
  SELECT "id", "organizationId"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfEnrollmentProgressCheckpoint" AS record
SET "completedByUserId" = target."id"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND record."completedByUserId" = 'user_alicia';

WITH target AS (
  SELECT "id", "organizationId"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfEnrollmentCheckpointEvidence" AS record
SET "addedByUserId" = target."id"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND record."addedByUserId" = 'user_alicia';

WITH target AS (
  SELECT "id", "organizationId"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfEnrollmentMonitoringHistory" AS record
SET "reviewedByUserId" = target."id"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND record."reviewedByUserId" = 'user_alicia';

WITH target AS (
  SELECT "id", "organizationId"
  FROM "AdminUser"
  WHERE LOWER("email") = 'eamanagementllc@gmail.com' AND "isActive" = true
)
UPDATE "CfEnrollmentMonitoringEvidence" AS record
SET "addedByUserId" = target."id"
FROM target
WHERE record."organizationId" = target."organizationId"
  AND record."addedByUserId" = 'user_alicia';