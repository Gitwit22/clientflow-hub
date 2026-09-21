CREATE TYPE "AdminRole" AS ENUM ('super_admin', 'org_admin', 'reviewer');

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "settings" JSONB,
  "liveMode" BOOLEAN NOT NULL DEFAULT false,
  "demoRemovedAt" TIMESTAMP(3),
  "principalAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "role" "AdminRole" NOT NULL DEFAULT 'reviewer',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminInvitation" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "Organization_principalAdminId_key" ON "Organization"("principalAdminId");
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
CREATE INDEX "AdminUser_organizationId_role_idx" ON "AdminUser"("organizationId", "role");
CREATE UNIQUE INDEX "AdminInvitation_adminUserId_key" ON "AdminInvitation"("adminUserId");
CREATE UNIQUE INDEX "AdminInvitation_tokenHash_key" ON "AdminInvitation"("tokenHash");
CREATE INDEX "AdminInvitation_tokenHash_idx" ON "AdminInvitation"("tokenHash");
CREATE UNIQUE INDEX "AuthSession_jti_key" ON "AuthSession"("jti");
CREATE INDEX "AuthSession_adminUserId_revokedAt_idx" ON "AuthSession"("adminUserId", "revokedAt");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

ALTER TABLE "AdminUser"
  ADD CONSTRAINT "AdminUser_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_principalAdminId_fkey"
  FOREIGN KEY ("principalAdminId") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminInvitation"
  ADD CONSTRAINT "AdminInvitation_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Organization" (
  "id", "name", "slug", "status", "createdAt", "updatedAt"
)
SELECT
  organization_id,
  'EA Management',
  'nxt-lvl',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT "organizationId" AS organization_id FROM "CfClient"
  UNION ALL
  SELECT "organizationId" AS organization_id FROM "CfProgram"
) clientflow_organizations
WHERE organization_id IS NOT NULL
LIMIT 1;

INSERT INTO "AdminUser" (
  "id", "organizationId", "email", "passwordHash", "firstName", "lastName",
  "role", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cm0eamanagementadmin000000001',
  "id",
  'eamanagementllc@gmail.com',
  '$2b$10$jvcfLdgW4KMMhWt0I9M/OODQnbhTO7ORV3t8CIeHV8olIJPduMaI2',
  'EA Management',
  'Admin',
  'org_admin',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization"
WHERE "slug" = 'nxt-lvl';