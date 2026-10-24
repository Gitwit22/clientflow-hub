-- Clients archived through the old "delete" route were archived without their enrollments (and
-- without an archive date), so those enrollments still showed up as program members, e.g. in the
-- program email list. Archive them now, the way "Move to archive" does. Idempotent; nothing is
-- deleted, and "Restore" brings the enrollments back with the client.

-- 1. Give archived clients without an archive date one (their last update), so Restore can match
--    the enrollments archived with them.
UPDATE "CfClient"
SET "archivedAt" = "updatedAt"
WHERE "isArchived" = true AND "archivedAt" IS NULL;

-- 2. Archive the enrollments of archived clients, dated with the client's archive date.
UPDATE "CfProgramEnrollment" AS e
SET "isArchived" = true, "archivedAt" = c."archivedAt"
FROM "CfClient" AS c
WHERE c."id" = e."clientId"
  AND c."organizationId" = e."organizationId"
  AND c."isArchived" = true
  AND e."isArchived" = false;
