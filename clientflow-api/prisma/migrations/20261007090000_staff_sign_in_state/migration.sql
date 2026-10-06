-- Staff sign-in state. Data only, safe to run more than once.

-- 1. Sign-ins were never recorded on AdminUser: take the latest session each member has had.
UPDATE "AdminUser" AS u
SET "lastLoginAt" = s."lastSession"
FROM (
  SELECT "adminUserId", MAX("createdAt") AS "lastSession"
  FROM "AuthSession"
  GROUP BY "adminUserId"
) AS s
WHERE s."adminUserId" = u."id"
  AND u."lastLoginAt" IS NULL;

-- 2. A member who has signed in has accepted their invitation, whatever the row says.
UPDATE "AdminInvitation" AS i
SET "acceptedAt" = COALESCE(u."lastLoginAt", CURRENT_TIMESTAMP)
FROM "AdminUser" AS u
WHERE u."id" = i."adminUserId"
  AND i."acceptedAt" IS NULL
  AND i."revokedAt" IS NULL
  AND u."lastLoginAt" IS NOT NULL;

-- 3. Each organization's principal admin is an active member.
UPDATE "AdminUser" AS u
SET "isActive" = true
FROM "Organization" AS o
WHERE o."principalAdminId" = u."id"
  AND u."isActive" = false;
