ALTER TABLE "CfContract"
  ADD COLUMN "staffSignedByUserId" TEXT,
  ADD COLUMN "staffSignedByName" TEXT,
  ADD COLUMN "staffSignedAt" TIMESTAMP(3);
