-- A program's own email signature and layout, replacing the organization's defaults (Settings) for
-- that program's emails. Null means "use the organization's". Additive only.

-- AlterTable
ALTER TABLE "CfProgram" ADD COLUMN "emailSignature" TEXT,
ADD COLUMN "emailLayout" TEXT;
