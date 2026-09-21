ALTER TABLE "CfDocument"
ADD COLUMN IF NOT EXISTS "objectKey" TEXT,
ADD COLUMN IF NOT EXISTS "bucket" TEXT,
ADD COLUMN IF NOT EXISTS "byteSize" INTEGER,
ADD COLUMN IF NOT EXISTS "checksum" TEXT,
ADD COLUMN IF NOT EXISTS "uploadStatus" TEXT NOT NULL DEFAULT 'ready';

CREATE UNIQUE INDEX IF NOT EXISTS "CfDocument_objectKey_key" ON "CfDocument"("objectKey");
CREATE INDEX IF NOT EXISTS "CfDocument_organizationId_uploadStatus_idx" ON "CfDocument"("organizationId", "uploadStatus");