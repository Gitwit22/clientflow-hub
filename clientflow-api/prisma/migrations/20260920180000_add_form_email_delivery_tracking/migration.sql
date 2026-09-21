ALTER TABLE "CfFormAssignment"
ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "CfCommunication"
ADD COLUMN "eventId" TEXT,
ADD COLUMN "formAssignmentId" TEXT,
ADD COLUMN "formId" TEXT,
ADD COLUMN "recipientEmail" TEXT,
ADD COLUMN "channel" TEXT,
ADD COLUMN "provider" TEXT,
ADD COLUMN "status" TEXT,
ADD COLUMN "requestedAt" TIMESTAMP(3),
ADD COLUMN "sentAt" TIMESTAMP(3),
ADD COLUMN "failedAt" TIMESTAMP(3),
ADD COLUMN "errorCode" TEXT,
ADD COLUMN "createdByUserId" TEXT;

CREATE UNIQUE INDEX "CfCommunication_eventId_key"
ON "CfCommunication"("eventId");

CREATE INDEX "CfCommunication_organizationId_status_idx"
ON "CfCommunication"("organizationId", "status");

CREATE INDEX "CfCommunication_organizationId_formAssignmentId_idx"
ON "CfCommunication"("organizationId", "formAssignmentId");
