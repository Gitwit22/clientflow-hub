-- Program Deliverables: what each program promises its clients per reporting period, tracked per
-- enrollment per cycle. Additive only: three new tables and their enums; nothing existing changes.

-- CreateEnum
CREATE TYPE "CfDeliverableCadence" AS ENUM ('MONTHLY', 'QUARTERLY', 'ONE_TIME', 'AS_NEEDED');

-- CreateEnum
CREATE TYPE "CfDeliverableCycleStatus" AS ENUM ('OPEN', 'FINALIZED');

-- CreateEnum
CREATE TYPE "CfDeliverableStatus" AS ENUM ('NOT_STARTED', 'AVAILABLE', 'SCHEDULED', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "CfProgramDeliverableTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cadence" "CfDeliverableCadence" NOT NULL DEFAULT 'MONTHLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfProgramDeliverableTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfEnrollmentDeliverableCycle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "cadence" "CfDeliverableCadence" NOT NULL DEFAULT 'MONTHLY',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "status" "CfDeliverableCycleStatus" NOT NULL DEFAULT 'OPEN',
    "finalizedAt" TIMESTAMP(3),
    "finalizedByUserId" TEXT,
    "finalizedByDisplayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfEnrollmentDeliverableCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfEnrollmentDeliverable" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "programDeliverableTemplateId" TEXT NOT NULL,
    "titleSnapshot" TEXT NOT NULL,
    "descriptionSnapshot" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CfDeliverableStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "scheduledFor" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "outcome" TEXT,
    "isNextAction" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfEnrollmentDeliverable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CfProgramDeliverableTemplate_organizationId_programId_activ_idx" ON "CfProgramDeliverableTemplate"("organizationId", "programId", "active");

-- CreateIndex
CREATE INDEX "CfEnrollmentDeliverableCycle_organizationId_enrollmentId_idx" ON "CfEnrollmentDeliverableCycle"("organizationId", "enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CfEnrollmentDeliverableCycle_enrollmentId_cadence_periodSta_key" ON "CfEnrollmentDeliverableCycle"("enrollmentId", "cadence", "periodStart");

-- CreateIndex
CREATE INDEX "CfEnrollmentDeliverable_organizationId_enrollmentId_idx" ON "CfEnrollmentDeliverable"("organizationId", "enrollmentId");

-- CreateIndex
CREATE INDEX "CfEnrollmentDeliverable_cycleId_idx" ON "CfEnrollmentDeliverable"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "CfEnrollmentDeliverable_cycleId_programDeliverableTemplateI_key" ON "CfEnrollmentDeliverable"("cycleId", "programDeliverableTemplateId");
