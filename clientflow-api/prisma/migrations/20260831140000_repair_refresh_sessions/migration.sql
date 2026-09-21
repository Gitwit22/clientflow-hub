ALTER TABLE "AuthSession"
ADD COLUMN IF NOT EXISTS "refreshTokenHash" TEXT,
ADD COLUMN IF NOT EXISTS "refreshExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "refreshRotatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_refreshTokenHash_key"
ON "AuthSession"("refreshTokenHash");

CREATE INDEX IF NOT EXISTS "AuthSession_refreshExpiresAt_idx"
ON "AuthSession"("refreshExpiresAt");