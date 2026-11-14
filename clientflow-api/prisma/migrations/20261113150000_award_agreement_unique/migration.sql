-- Award agreements: at most one OPEN agreement per funding award, enforced by the database, so two
-- simultaneous "prepare agreement" requests can never both create one. Replaced, cancelled and
-- signed agreements stay as history (they are not open). The open statuses match
-- OPEN_CONTRACT_STATUSES in src/modules/lifecycle/contract-state.ts. Additive only.

-- CreateIndex
CREATE UNIQUE INDEX "CfContract_awardId_open_key"
  ON "CfContract"("awardId")
  WHERE "awardId" IS NOT NULL AND "status" IN ('DRAFT', 'SENT', 'OPENED', 'EXPIRED');
