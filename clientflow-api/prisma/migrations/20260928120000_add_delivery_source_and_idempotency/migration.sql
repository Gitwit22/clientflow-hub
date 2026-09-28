-- Non-destructive: adds nullable columns and one unique index. Existing rows are untouched
-- (source and idempotencyKey stay NULL). PostgreSQL treats NULLs as distinct in a unique index,
-- so the many existing rows with a NULL idempotencyKey do not conflict.

-- Where an action came from (manual_staff_action, automation, public_form).
ALTER TABLE "CfActivityLog" ADD COLUMN "source" TEXT;
ALTER TABLE "CfCommunication" ADD COLUMN "source" TEXT;

-- One key per manual send attempt; a retried request reuses it instead of sending twice.
ALTER TABLE "CfCommunication" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "CfCommunication_organizationId_idempotencyKey_key"
  ON "CfCommunication"("organizationId", "idempotencyKey");
