UPDATE "Organization"
SET "status" = 'active', "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'nxt-lvl';

INSERT INTO "AdminUser" (
  "id", "organizationId", "email", "passwordHash", "firstName", "lastName",
  "role", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cm0eamanagementadmin000000001',
  "id",
  'eamanagementllc@gmail.com',
  '$2b$12$KVOwN.YulqMi0OyjsC4TLOWphUqaHQgw.lMrWtehggJoKd1ksoihG',
  'EA Management',
  'Admin',
  'org_admin',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization"
WHERE "slug" = 'nxt-lvl'
ON CONFLICT ("email") DO UPDATE SET
  "organizationId" = EXCLUDED."organizationId",
  "passwordHash" = EXCLUDED."passwordHash",
  "role" = 'org_admin',
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
