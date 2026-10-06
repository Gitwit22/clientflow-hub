-- Program-wide deliverable dates: a deliverable can take its date from the program (one date per
-- month for every member) instead of each client's checklist. Additive only.

-- AlterTable
ALTER TABLE "CfProgramDeliverableTemplate" ADD COLUMN "programWideDate" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CfProgramDeliverableSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfProgramDeliverableSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CfProgramDeliverableSchedule_organizationId_programId_perio_idx" ON "CfProgramDeliverableSchedule"("organizationId", "programId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "CfProgramDeliverableSchedule_templateId_periodStart_key" ON "CfProgramDeliverableSchedule"("templateId", "periodStart");
