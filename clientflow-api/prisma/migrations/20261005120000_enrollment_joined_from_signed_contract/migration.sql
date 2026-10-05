-- An enrollment's start date is the day the client joined the program: the day they signed its
-- contract. Signing now records it; this fills it for enrollments signed before that.
--
-- Rows the Sept 30 legacy backfill created ('cfenr_' ids, never edited by staff) got the migration
-- time as their start date (equal to their createdAt). Those take the signing date, or are cleared
-- when no signed contract exists so staff can enter the real date. Dates staff entered are kept.
-- Idempotent: a rerun sets the same values.

WITH signed AS (
  SELECT e."id" AS "enrollmentId", MIN(COALESCE(k."signedAt", k."completedAt")) AS "joinedAt"
  FROM "CfProgramEnrollment" e
  JOIN "CfContract" k
    ON k."organizationId" = e."organizationId"
   AND k."status" = 'COMPLETED'
   AND (
     k."enrollmentId" = e."id"
     OR (k."enrollmentId" IS NULL AND k."clientId" = e."clientId" AND k."programId" = e."programId")
   )
  GROUP BY e."id"
)
UPDATE "CfProgramEnrollment" e
SET "startDate" = signed."joinedAt"
FROM signed
WHERE e."id" = signed."enrollmentId"
  AND signed."joinedAt" IS NOT NULL
  AND (
    e."startDate" IS NULL
    OR (
      e."id" LIKE 'cfenr\_%'
      AND e."lastModifiedByDisplayName" = 'system'
      AND e."startDate" = e."createdAt"
    )
  );

UPDATE "CfProgramEnrollment" e
SET "startDate" = NULL
WHERE e."id" LIKE 'cfenr\_%'
  AND e."lastModifiedByDisplayName" = 'system'
  AND e."startDate" = e."createdAt"
  AND NOT EXISTS (
    SELECT 1 FROM "CfContract" k
    WHERE k."organizationId" = e."organizationId"
      AND k."status" = 'COMPLETED'
      AND (
        k."enrollmentId" = e."id"
        OR (k."enrollmentId" IS NULL AND k."clientId" = e."clientId" AND k."programId" = e."programId")
      )
  );
