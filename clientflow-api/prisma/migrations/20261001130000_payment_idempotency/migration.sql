-- A recorded payment can carry the client's Idempotency-Key, so a retried "Record payment"
-- request returns the first record instead of recording the money twice. NULLs stay distinct.
ALTER TABLE "CfPaymentRecord" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "CfPaymentRecord_organizationId_idempotencyKey_key" ON "CfPaymentRecord"("organizationId", "idempotencyKey");
