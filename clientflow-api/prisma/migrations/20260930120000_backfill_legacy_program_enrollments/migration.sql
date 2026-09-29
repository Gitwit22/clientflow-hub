-- Enrollment is the canonical client -> program relationship: workflow code (review approval,
-- contracts, automation) no longer reads CfClient.programId. Clients whose program was only ever
-- recorded in that legacy column get the matching enrollment here, so they keep working.
-- Idempotent: only (client, program) pairs without an enrollment are inserted.

WITH legacy AS (
  SELECT
    c."id" AS "clientId",
    c."organizationId",
    c."programId",
    c."assignedUserId",
    c."assignedStaff",
    c."isDemo",
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "CfContract" k
        WHERE k."clientId" = c."id" AND k."programId" = c."programId" AND k."status" = 'COMPLETED'
      ) THEN 'active'
      WHEN c."status" = 'ONBOARDING' THEN 'active'
      WHEN c."status" IN ('CONTRACT_SENT', 'CONTRACT_OPENED') THEN 'onboarding'
      WHEN c."status" = 'PENDING_STAFF_REVIEW' THEN 'pending_review'
      WHEN c."status" = 'REVIEW_DECLINED' THEN 'declined'
      ELSE 'interested'
    END AS "status"
  FROM "CfClient" c
  JOIN "CfProgram" p ON p."id" = c."programId" AND p."organizationId" = c."organizationId"
  WHERE c."programId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "CfProgramEnrollment" e
      WHERE e."clientId" = c."id" AND e."programId" = c."programId"
    )
),
inserted AS (
  INSERT INTO "CfProgramEnrollment" (
    "id", "organizationId", "clientId", "programId", "status", "assignedUserId", "assignedStaff",
    "lastModifiedByDisplayName", "startDate", "isDemo", "createdAt", "updatedAt"
  )
  SELECT
    'cfenr_' || md5(legacy."clientId" || ':' || legacy."programId"),
    legacy."organizationId",
    legacy."clientId",
    legacy."programId",
    legacy."status"::"CfEnrollmentStatus",
    legacy."assignedUserId",
    legacy."assignedStaff",
    'system',
    CASE WHEN legacy."status" = 'active' THEN CURRENT_TIMESTAMP ELSE NULL END,
    legacy."isDemo",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM legacy
  RETURNING "id", "organizationId", "status"
)
INSERT INTO "CfEnrollmentStatusHistory" (
  "id", "organizationId", "enrollmentId", "previousStatus", "newStatus", "changedByDisplayName", "reason", "createdAt"
)
SELECT
  'cfesh_' || md5(inserted."id" || ':backfill'),
  inserted."organizationId",
  inserted."id",
  NULL,
  inserted."status",
  'system',
  'Backfilled from the legacy client program.',
  CURRENT_TIMESTAMP
FROM inserted;

-- Contracts created before enrollments existed point at their (client, program) enrollment.
UPDATE "CfContract" k
SET "enrollmentId" = e."id"
FROM "CfProgramEnrollment" e
WHERE k."enrollmentId" IS NULL
  AND e."clientId" = k."clientId"
  AND e."programId" = k."programId"
  AND e."organizationId" = k."organizationId";
