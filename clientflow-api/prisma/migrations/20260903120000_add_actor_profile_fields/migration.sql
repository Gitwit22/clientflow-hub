ALTER TABLE "AdminUser" ADD COLUMN "jobTitle" TEXT;
ALTER TABLE "CfActivityLog" ADD COLUMN "actorUserId" TEXT;

CREATE INDEX "CfActivityLog_organizationId_actorUserId_idx"
ON "CfActivityLog"("organizationId", "actorUserId");