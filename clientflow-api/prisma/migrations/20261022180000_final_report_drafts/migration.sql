-- Final reports: drafts and finalized snapshots. Additive only.
-- Every report saved before this existed already applied its decision, so it is FINALIZED;
-- new reports start as DRAFT.

-- AlterTable
ALTER TABLE "CfFinalReport" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'FINALIZED';
ALTER TABLE "CfFinalReport" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "CfFinalReport" ADD COLUMN "finalizedAt" TIMESTAMP(3);
ALTER TABLE "CfFinalReport" ADD COLUMN "finalizedByUserId" TEXT;
ALTER TABLE "CfFinalReport" ADD COLUMN "finalizedByDisplayName" TEXT;
ALTER TABLE "CfFinalReport" ADD COLUMN "snapshot" JSONB;

-- Older reports were finalized when they were saved.
UPDATE "CfFinalReport" SET "finalizedAt" = "createdAt" WHERE "finalizedAt" IS NULL AND "status" = 'FINALIZED';
