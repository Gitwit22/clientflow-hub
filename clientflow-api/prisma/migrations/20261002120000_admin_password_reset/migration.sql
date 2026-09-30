-- One-time password reset links that an organization admin copies to a staff member. Only the
-- SHA-256 hash of the token is stored; a link expires after an hour and works once.
CREATE TABLE "AdminPasswordReset" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminPasswordReset_tokenHash_key" ON "AdminPasswordReset"("tokenHash");
CREATE INDEX "AdminPasswordReset_adminUserId_idx" ON "AdminPasswordReset"("adminUserId");

ALTER TABLE "AdminPasswordReset" ADD CONSTRAINT "AdminPasswordReset_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
