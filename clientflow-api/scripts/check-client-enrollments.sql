-- READ-ONLY. Run in the Neon SQL editor. Nothing here modifies data.
-- Purpose: for a client, list every enrollment row and its program, to tell whether repeated
-- program badges in the UI are real duplicate rows or a frontend-only rendering bug.
-- Edit the name below if needed.

-- 1) The client(s) matching the name.
SELECT id, "organizationId", "businessName", "programId" AS "legacyProgramId", "isArchived"
FROM "CfClient"
WHERE "businessName" ILIKE '%Keep it Moving%';

-- 2) Every enrollment for those clients (expect ONE row per (clientId, programId)).
SELECT
  e.id AS "enrollmentId",
  e."clientId",
  e."programId",
  p.name AS "programName",
  e.status,
  e."isArchived",
  e."createdAt"
FROM "CfProgramEnrollment" e
JOIN "CfClient" c ON c.id = e."clientId"
LEFT JOIN "CfProgram" p ON p.id = e."programId"
WHERE c."businessName" ILIKE '%Keep it Moving%'
ORDER BY e."createdAt";

-- 3) Duplicate programs by name (would explain several distinct programs with the same label).
SELECT id, name, "organizationId", "isActive", "createdAt"
FROM "CfProgram"
WHERE name ILIKE '%Inspired Detroit%'
ORDER BY "createdAt";

-- 4) Any (clientId, programId) pair with more than one enrollment. Should return zero rows; the
--    unique index "CfProgramEnrollment_clientId_programId_key" is meant to prevent this.
SELECT "clientId", "programId", COUNT(*) AS "rows"
FROM "CfProgramEnrollment"
GROUP BY "clientId", "programId"
HAVING COUNT(*) > 1;

-- 5) Confirm the unique index exists in this database.
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'CfProgramEnrollment' AND indexdef ILIKE '%UNIQUE%';
