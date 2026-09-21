CREATE TYPE "CfTemplateVersionStatus" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "CfProgressCalculationMethod" AS ENUM ('equal_weight', 'custom_weight');
CREATE TYPE "CfProgramProgressTrackStatus" AS ENUM ('active', 'inactive', 'archived');
CREATE TYPE "CfEnrollmentProgressTrackStatus" AS ENUM ('not_started', 'in_progress', 'completed', 'skipped');
CREATE TYPE "CfEnrollmentProgressCheckpointStatus" AS ENUM ('not_started', 'in_progress', 'completed', 'blocked', 'skipped');
CREATE TYPE "CfEnrollmentGoalStatus" AS ENUM ('not_started', 'in_progress', 'achieved', 'partially_achieved', 'blocked', 'abandoned');
CREATE TYPE "CfMonitoringFrequency" AS ENUM ('once', 'weekly', 'monthly', 'quarterly', 'annually', 'custom');
CREATE TYPE "CfMonitoringComplianceStatus" AS ENUM ('pending', 'compliant', 'partially_compliant', 'non_compliant', 'not_applicable');
CREATE TYPE "CfEnrollmentRiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "CfClientResponsiveness" AS ENUM ('responsive', 'inconsistent', 'unresponsive', 'unknown');
CREATE TYPE "CfOutcomeAchieved" AS ENUM ('yes', 'partial', 'no', 'pending');

DROP TABLE "CfMonitoringItem";

ALTER TABLE "CfProgramEnrollment"
  ADD COLUMN "targetCompletionDate" TIMESTAMP(3),
  ADD COLUMN "currentGoalId" TEXT,
  ADD COLUMN "lastProgressUpdate" TIMESTAMP(3),
  ADD COLUMN "clientResponsiveness" "CfClientResponsiveness" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "currentBlockers" TEXT,
  ADD COLUMN "riskLevel" "CfEnrollmentRiskLevel" NOT NULL DEFAULT 'low',
  ADD COLUMN "staffProgressNotes" TEXT,
  ADD COLUMN "meetingsAttended" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outcomeAchieved" "CfOutcomeAchieved" NOT NULL DEFAULT 'pending',
  ADD COLUMN "finalOutcomeSummary" TEXT;

UPDATE "CfProgramEnrollment" SET "progressPercentage" = 0;

ALTER TABLE "CfTask" ADD COLUMN "enrollmentCheckpointId" TEXT;
CREATE INDEX "CfTask_enrollmentCheckpointId_idx" ON "CfTask"("enrollmentCheckpointId");

CREATE TABLE "CfProgramProgressTemplateVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "CfTemplateVersionStatus" NOT NULL DEFAULT 'draft',
  "trackCalculationMethod" "CfProgressCalculationMethod" NOT NULL DEFAULT 'equal_weight',
  "publishedAt" TIMESTAMP(3),
  "publishedByUserId" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramProgressTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfProgramProgressTrack" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "templateVersionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "status" "CfProgramProgressTrackStatus" NOT NULL DEFAULT 'active',
  "calculationMethod" "CfProgressCalculationMethod" NOT NULL DEFAULT 'equal_weight',
  "weight" DECIMAL(5,2),
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramProgressTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfProgramProgressCheckpoint" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "templateVersionId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "weight" DECIMAL(5,2),
  "defaultDueDays" INTEGER,
  "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
  "evidenceInstructions" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramProgressCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfProgramGoalCategory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramGoalCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfProgramMonitoringTemplateVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "CfTemplateVersionStatus" NOT NULL DEFAULT 'draft',
  "publishedAt" TIMESTAMP(3),
  "publishedByUserId" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramMonitoringTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfMonitoringRequirement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "templateVersionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "frequency" "CfMonitoringFrequency" NOT NULL,
  "customIntervalDays" INTEGER,
  "expectedValue" DECIMAL(18,2),
  "unit" TEXT,
  "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfMonitoringRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfEnrollmentProgressPlan" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "sourceTemplateVersionId" TEXT,
  "revision" INTEGER NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "replacedAt" TIMESTAMP(3),
  "replacedByUserId" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfEnrollmentProgressPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfEnrollmentProgressTrack" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "progressPlanId" TEXT NOT NULL,
  "sourceProgramTrackId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "calculationMethod" "CfProgressCalculationMethod" NOT NULL,
  "weight" DECIMAL(5,2),
  "progressPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "status" "CfEnrollmentProgressTrackStatus" NOT NULL DEFAULT 'not_started',
  "completedAt" TIMESTAMP(3),
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfEnrollmentProgressTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfEnrollmentProgressCheckpoint" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "enrollmentTrackId" TEXT NOT NULL,
  "sourceProgramCheckpointId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "weight" DECIMAL(5,2),
  "status" "CfEnrollmentProgressCheckpointStatus" NOT NULL DEFAULT 'not_started',
  "dueDate" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "completedByUserId" TEXT,
  "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
  "evidenceInstructions" TEXT,
  "notes" TEXT,
  "skipReason" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfEnrollmentProgressCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfEnrollmentCheckpointEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "enrollmentCheckpointId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "addedByUserId" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfEnrollmentCheckpointEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfEnrollmentGoal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "categoryId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "baselineValue" DECIMAL(18,2),
  "targetValue" DECIMAL(18,2),
  "currentValue" DECIMAL(18,2),
  "unit" TEXT,
  "targetDate" TIMESTAMP(3),
  "status" "CfEnrollmentGoalStatus" NOT NULL DEFAULT 'not_started',
  "progressPercent" DECIMAL(5,2),
  "notes" TEXT,
  "completedAt" TIMESTAMP(3),
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfEnrollmentGoal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfEnrollmentMonitoring" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "monitoringRequirementId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "frequency" "CfMonitoringFrequency" NOT NULL,
  "customIntervalDays" INTEGER,
  "expectedValue" DECIMAL(18,2),
  "actualValue" DECIMAL(18,2),
  "unit" TEXT,
  "complianceStatus" "CfMonitoringComplianceStatus" NOT NULL DEFAULT 'pending',
  "lastReviewedAt" TIMESTAMP(3),
  "nextReviewAt" TIMESTAMP(3),
  "assignedReviewerId" TEXT,
  "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
  "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfEnrollmentMonitoring_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfEnrollmentMonitoringHistory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "enrollmentMonitoringId" TEXT NOT NULL,
  "expectedValue" DECIMAL(18,2),
  "actualValue" DECIMAL(18,2),
  "unit" TEXT,
  "complianceStatus" "CfMonitoringComplianceStatus" NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextReviewAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "previousValue" JSONB,
  "newValue" JSONB,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfEnrollmentMonitoringHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfEnrollmentMonitoringEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "enrollmentMonitoringHistoryId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "addedByUserId" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfEnrollmentMonitoringEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CfProgramProgressTemplateVersion_organizationId_programId_s_idx" ON "CfProgramProgressTemplateVersion"("organizationId", "programId", "status");
CREATE INDEX "CfProgramProgressTemplateVersion_organizationId_isDemo_idx" ON "CfProgramProgressTemplateVersion"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfProgramProgressTemplateVersion_organizationId_programId_v_key" ON "CfProgramProgressTemplateVersion"("organizationId", "programId", "version");
CREATE INDEX "CfProgramProgressTrack_organizationId_programId_idx" ON "CfProgramProgressTrack"("organizationId", "programId");
CREATE INDEX "CfProgramProgressTrack_organizationId_templateVersionId_sta_idx" ON "CfProgramProgressTrack"("organizationId", "templateVersionId", "status");
CREATE INDEX "CfProgramProgressTrack_organizationId_isDemo_idx" ON "CfProgramProgressTrack"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfProgramProgressTrack_templateVersionId_position_key" ON "CfProgramProgressTrack"("templateVersionId", "position");
CREATE INDEX "CfProgramProgressCheckpoint_organizationId_programId_idx" ON "CfProgramProgressCheckpoint"("organizationId", "programId");
CREATE INDEX "CfProgramProgressCheckpoint_organizationId_templateVersionI_idx" ON "CfProgramProgressCheckpoint"("organizationId", "templateVersionId");
CREATE INDEX "CfProgramProgressCheckpoint_organizationId_trackId_idx" ON "CfProgramProgressCheckpoint"("organizationId", "trackId");
CREATE INDEX "CfProgramProgressCheckpoint_organizationId_isDemo_idx" ON "CfProgramProgressCheckpoint"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfProgramProgressCheckpoint_trackId_position_key" ON "CfProgramProgressCheckpoint"("trackId", "position");
CREATE INDEX "CfProgramGoalCategory_organizationId_programId_position_idx" ON "CfProgramGoalCategory"("organizationId", "programId", "position");
CREATE INDEX "CfProgramGoalCategory_organizationId_isDemo_idx" ON "CfProgramGoalCategory"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfProgramGoalCategory_organizationId_programId_name_key" ON "CfProgramGoalCategory"("organizationId", "programId", "name");
CREATE INDEX "CfProgramMonitoringTemplateVersion_organizationId_programId_idx" ON "CfProgramMonitoringTemplateVersion"("organizationId", "programId", "status");
CREATE INDEX "CfProgramMonitoringTemplateVersion_organizationId_isDemo_idx" ON "CfProgramMonitoringTemplateVersion"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfProgramMonitoringTemplateVersion_organizationId_programId_key" ON "CfProgramMonitoringTemplateVersion"("organizationId", "programId", "version");
CREATE INDEX "CfMonitoringRequirement_organizationId_programId_idx" ON "CfMonitoringRequirement"("organizationId", "programId");
CREATE INDEX "CfMonitoringRequirement_organizationId_templateVersionId_ac_idx" ON "CfMonitoringRequirement"("organizationId", "templateVersionId", "active");
CREATE INDEX "CfMonitoringRequirement_organizationId_isDemo_idx" ON "CfMonitoringRequirement"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfMonitoringRequirement_templateVersionId_position_key" ON "CfMonitoringRequirement"("templateVersionId", "position");
CREATE INDEX "CfEnrollmentProgressPlan_organizationId_enrollmentId_isCurr_idx" ON "CfEnrollmentProgressPlan"("organizationId", "enrollmentId", "isCurrent");
CREATE INDEX "CfEnrollmentProgressPlan_organizationId_isDemo_idx" ON "CfEnrollmentProgressPlan"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfEnrollmentProgressPlan_enrollmentId_revision_key" ON "CfEnrollmentProgressPlan"("enrollmentId", "revision");
CREATE INDEX "CfEnrollmentProgressTrack_organizationId_enrollmentId_idx" ON "CfEnrollmentProgressTrack"("organizationId", "enrollmentId");
CREATE INDEX "CfEnrollmentProgressTrack_organizationId_progressPlanId_idx" ON "CfEnrollmentProgressTrack"("organizationId", "progressPlanId");
CREATE INDEX "CfEnrollmentProgressTrack_organizationId_isDemo_idx" ON "CfEnrollmentProgressTrack"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfEnrollmentProgressTrack_progressPlanId_position_key" ON "CfEnrollmentProgressTrack"("progressPlanId", "position");
CREATE INDEX "CfEnrollmentProgressCheckpoint_organizationId_enrollmentId__idx" ON "CfEnrollmentProgressCheckpoint"("organizationId", "enrollmentId", "status");
CREATE INDEX "CfEnrollmentProgressCheckpoint_organizationId_enrollmentTra_idx" ON "CfEnrollmentProgressCheckpoint"("organizationId", "enrollmentTrackId");
CREATE INDEX "CfEnrollmentProgressCheckpoint_organizationId_dueDate_idx" ON "CfEnrollmentProgressCheckpoint"("organizationId", "dueDate");
CREATE INDEX "CfEnrollmentProgressCheckpoint_organizationId_isDemo_idx" ON "CfEnrollmentProgressCheckpoint"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfEnrollmentProgressCheckpoint_enrollmentTrackId_position_key" ON "CfEnrollmentProgressCheckpoint"("enrollmentTrackId", "position");
CREATE INDEX "CfEnrollmentCheckpointEvidence_organizationId_enrollmentId_idx" ON "CfEnrollmentCheckpointEvidence"("organizationId", "enrollmentId");
CREATE INDEX "CfEnrollmentCheckpointEvidence_organizationId_documentId_idx" ON "CfEnrollmentCheckpointEvidence"("organizationId", "documentId");
CREATE INDEX "CfEnrollmentCheckpointEvidence_organizationId_isDemo_idx" ON "CfEnrollmentCheckpointEvidence"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfEnrollmentCheckpointEvidence_enrollmentCheckpointId_docum_key" ON "CfEnrollmentCheckpointEvidence"("enrollmentCheckpointId", "documentId");
CREATE INDEX "CfEnrollmentGoal_organizationId_enrollmentId_status_idx" ON "CfEnrollmentGoal"("organizationId", "enrollmentId", "status");
CREATE INDEX "CfEnrollmentGoal_organizationId_categoryId_idx" ON "CfEnrollmentGoal"("organizationId", "categoryId");
CREATE INDEX "CfEnrollmentGoal_organizationId_isDemo_idx" ON "CfEnrollmentGoal"("organizationId", "isDemo");
CREATE INDEX "CfEnrollmentMonitoring_organizationId_enrollmentId_active_idx" ON "CfEnrollmentMonitoring"("organizationId", "enrollmentId", "active");
CREATE INDEX "CfEnrollmentMonitoring_organizationId_nextReviewAt_idx" ON "CfEnrollmentMonitoring"("organizationId", "nextReviewAt");
CREATE INDEX "CfEnrollmentMonitoring_organizationId_complianceStatus_idx" ON "CfEnrollmentMonitoring"("organizationId", "complianceStatus");
CREATE INDEX "CfEnrollmentMonitoring_organizationId_isDemo_idx" ON "CfEnrollmentMonitoring"("organizationId", "isDemo");
CREATE INDEX "CfEnrollmentMonitoringHistory_organizationId_enrollmentId_idx" ON "CfEnrollmentMonitoringHistory"("organizationId", "enrollmentId");
CREATE INDEX "CfEnrollmentMonitoringHistory_organizationId_enrollmentMoni_idx" ON "CfEnrollmentMonitoringHistory"("organizationId", "enrollmentMonitoringId", "reviewedAt");
CREATE INDEX "CfEnrollmentMonitoringHistory_organizationId_isDemo_idx" ON "CfEnrollmentMonitoringHistory"("organizationId", "isDemo");
CREATE INDEX "CfEnrollmentMonitoringEvidence_organizationId_enrollmentId_idx" ON "CfEnrollmentMonitoringEvidence"("organizationId", "enrollmentId");
CREATE INDEX "CfEnrollmentMonitoringEvidence_organizationId_documentId_idx" ON "CfEnrollmentMonitoringEvidence"("organizationId", "documentId");
CREATE INDEX "CfEnrollmentMonitoringEvidence_organizationId_isDemo_idx" ON "CfEnrollmentMonitoringEvidence"("organizationId", "isDemo");
CREATE UNIQUE INDEX "CfEnrollmentMonitoringEvidence_enrollmentMonitoringHistoryI_key" ON "CfEnrollmentMonitoringEvidence"("enrollmentMonitoringHistoryId", "documentId");