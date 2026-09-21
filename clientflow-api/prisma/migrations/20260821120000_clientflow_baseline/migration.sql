-- CreateEnum
CREATE TYPE "CfEnrollmentStatus" AS ENUM ('interested', 'pending_review', 'approved', 'onboarding', 'active', 'on_hold', 'completed', 'declined', 'withdrawn');

-- CreateTable
CREATE TABLE "CfClient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "primaryContactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "website" TEXT,
    "socialLinks" JSONB NOT NULL DEFAULT '[]',
    "programId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New Intake',
    "profileType" TEXT,
    "relationshipType" TEXT,
    "lifecycleStatus" TEXT,
    "assignedStaff" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "intakeSource" TEXT NOT NULL DEFAULT 'admin_created',
    "source" TEXT,
    "nextFollowUpDate" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "finalStatus" TEXT,
    "archivedAt" TIMESTAMP(3),
    "intake" JSONB NOT NULL,
    "snapchat" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfProgram" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "financialTrackingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultFormTemplateId" TEXT NOT NULL,
    "defaultMonitoringFrequency" TEXT NOT NULL,
    "defaultContractTemplateId" TEXT NOT NULL,
    "defaultWorkflow" JSONB NOT NULL DEFAULT '[]',
    "requiredDocuments" JSONB NOT NULL DEFAULT '[]',
    "statusPipeline" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfFormTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'legacy',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "emailTemplate" TEXT NOT NULL,
    "internalNotes" TEXT,
    "dueInDays" INTEGER NOT NULL DEFAULT 7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfFormAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "formId" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "completionMethod" TEXT,
    "deliveryMethod" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "dueAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "dueDate" TEXT,
    "secureLink" TEXT,
    "secureLinkToken" TEXT,
    "responses" JSONB,
    "editHistory" JSONB,
    "createdByUserId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfFormAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfTerms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "programId" TEXT NOT NULL,
    "supportType" TEXT NOT NULL,
    "fundingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "resourceDescription" TEXT NOT NULL,
    "grantAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loanAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "investmentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "forgivableAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repaymentRequired" BOOLEAN NOT NULL DEFAULT false,
    "repaymentSchedule" TEXT NOT NULL,
    "interestDescription" TEXT NOT NULL,
    "milestones" TEXT NOT NULL,
    "reportingRequirements" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "monitoringFrequency" TEXT NOT NULL,
    "specialConditions" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'Pending',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfMonitoringItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "programId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "assignedStaff" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "completedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfMonitoringItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfContract" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "programId" TEXT NOT NULL,
    "termsId" TEXT,
    "contractType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "content" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfCommunication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "staffMember" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfCommunication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfFinalReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "programId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "originalNeed" TEXT NOT NULL,
    "supportProvided" TEXT NOT NULL,
    "fundingProvided" TEXT NOT NULL,
    "milestonesCompleted" TEXT NOT NULL,
    "resultsAchieved" TEXT NOT NULL,
    "issuesEncountered" TEXT NOT NULL,
    "staffComments" TEXT NOT NULL,
    "clientOutcome" TEXT NOT NULL,
    "recommendedNextSteps" TEXT NOT NULL,
    "archiveDecision" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfFinalReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfActivityLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CfActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfProgramEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "status" "CfEnrollmentStatus" NOT NULL DEFAULT 'interested',
    "assignedUserId" TEXT,
    "assignedStaff" TEXT,
    "startDate" TIMESTAMP(3),
    "nextAction" TEXT,
    "nextActionDate" TIMESTAMP(3),
    "progressPercentage" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "onHoldReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfProgramEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfEnrollmentStatusHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "previousStatus" "CfEnrollmentStatus",
    "newStatus" "CfEnrollmentStatus" NOT NULL,
    "changedByUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CfEnrollmentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfIntakeSubmission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "formAssignmentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "configurationToken" TEXT NOT NULL,
    "responsePayload" JSONB NOT NULL,
    "resultPayload" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "submitterEmail" TEXT,
    "submitterName" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CfIntakeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfIntakeRenderSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "formAssignmentId" TEXT NOT NULL,
    "configurationToken" TEXT NOT NULL,
    "coreTemplateId" TEXT NOT NULL,
    "coreTemplateVersion" INTEGER NOT NULL,
    "renderedSections" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CfIntakeRenderSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfIntakeSubmissionSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "intakeSubmissionId" TEXT NOT NULL,
    "coreTemplateId" TEXT NOT NULL,
    "coreTemplateVersion" INTEGER NOT NULL,
    "selectedProgramIds" TEXT[],
    "renderedSections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CfIntakeSubmissionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfIntakeSubmissionProgram" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "intakeSubmissionId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CfIntakeSubmissionProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assignedUserId" TEXT,
    "assignedStaff" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CfClient_organizationId_idx" ON "CfClient"("organizationId");

-- CreateIndex
CREATE INDEX "CfClient_organizationId_isDemo_idx" ON "CfClient"("organizationId", "isDemo");

-- CreateIndex
CREATE INDEX "CfClient_organizationId_isArchived_idx" ON "CfClient"("organizationId", "isArchived");

-- CreateIndex
CREATE INDEX "CfProgram_organizationId_idx" ON "CfProgram"("organizationId");

-- CreateIndex
CREATE INDEX "CfFormTemplate_organizationId_idx" ON "CfFormTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "CfFormTemplate_organizationId_scope_programId_idx" ON "CfFormTemplate"("organizationId", "scope", "programId");

-- CreateIndex
CREATE UNIQUE INDEX "CfFormAssignment_secureLinkToken_key" ON "CfFormAssignment"("secureLinkToken");

-- CreateIndex
CREATE INDEX "CfFormAssignment_organizationId_idx" ON "CfFormAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "CfFormAssignment_organizationId_isDemo_idx" ON "CfFormAssignment"("organizationId", "isDemo");

-- CreateIndex
CREATE INDEX "CfFormAssignment_organizationId_clientId_idx" ON "CfFormAssignment"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfFormAssignment_enrollmentId_idx" ON "CfFormAssignment"("enrollmentId");

-- CreateIndex
CREATE INDEX "CfTerms_organizationId_isDemo_idx" ON "CfTerms"("organizationId", "isDemo");

-- CreateIndex
CREATE INDEX "CfTerms_organizationId_clientId_idx" ON "CfTerms"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfTerms_enrollmentId_idx" ON "CfTerms"("enrollmentId");

-- CreateIndex
CREATE INDEX "CfMonitoringItem_organizationId_idx" ON "CfMonitoringItem"("organizationId");

-- CreateIndex
CREATE INDEX "CfMonitoringItem_organizationId_isDemo_idx" ON "CfMonitoringItem"("organizationId", "isDemo");

-- CreateIndex
CREATE INDEX "CfMonitoringItem_organizationId_clientId_idx" ON "CfMonitoringItem"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfMonitoringItem_enrollmentId_idx" ON "CfMonitoringItem"("enrollmentId");

-- CreateIndex
CREATE INDEX "CfContract_organizationId_idx" ON "CfContract"("organizationId");

-- CreateIndex
CREATE INDEX "CfContract_organizationId_isDemo_idx" ON "CfContract"("organizationId", "isDemo");

-- CreateIndex
CREATE INDEX "CfContract_organizationId_clientId_idx" ON "CfContract"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfContract_enrollmentId_idx" ON "CfContract"("enrollmentId");

-- CreateIndex
CREATE INDEX "CfDocument_organizationId_isDemo_idx" ON "CfDocument"("organizationId", "isDemo");

-- CreateIndex
CREATE INDEX "CfDocument_organizationId_clientId_idx" ON "CfDocument"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfDocument_enrollmentId_idx" ON "CfDocument"("enrollmentId");

-- CreateIndex
CREATE INDEX "CfCommunication_organizationId_isDemo_idx" ON "CfCommunication"("organizationId", "isDemo");

-- CreateIndex
CREATE INDEX "CfCommunication_organizationId_clientId_idx" ON "CfCommunication"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfCommunication_enrollmentId_idx" ON "CfCommunication"("enrollmentId");

-- CreateIndex
CREATE INDEX "CfFinalReport_organizationId_isDemo_idx" ON "CfFinalReport"("organizationId", "isDemo");

-- CreateIndex
CREATE INDEX "CfFinalReport_organizationId_clientId_idx" ON "CfFinalReport"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfFinalReport_enrollmentId_idx" ON "CfFinalReport"("enrollmentId");

-- CreateIndex
CREATE INDEX "CfActivityLog_organizationId_idx" ON "CfActivityLog"("organizationId");

-- CreateIndex
CREATE INDEX "CfActivityLog_organizationId_isDemo_idx" ON "CfActivityLog"("organizationId", "isDemo");

-- CreateIndex
CREATE INDEX "CfActivityLog_organizationId_clientId_idx" ON "CfActivityLog"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfActivityLog_enrollmentId_idx" ON "CfActivityLog"("enrollmentId");

-- CreateIndex
CREATE INDEX "CfProgramEnrollment_organizationId_idx" ON "CfProgramEnrollment"("organizationId");

-- CreateIndex
CREATE INDEX "CfProgramEnrollment_organizationId_programId_status_idx" ON "CfProgramEnrollment"("organizationId", "programId", "status");

-- CreateIndex
CREATE INDEX "CfProgramEnrollment_organizationId_clientId_idx" ON "CfProgramEnrollment"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfProgramEnrollment_organizationId_isDemo_idx" ON "CfProgramEnrollment"("organizationId", "isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "CfProgramEnrollment_clientId_programId_key" ON "CfProgramEnrollment"("clientId", "programId");

-- CreateIndex
CREATE INDEX "CfEnrollmentStatusHistory_organizationId_enrollmentId_idx" ON "CfEnrollmentStatusHistory"("organizationId", "enrollmentId");

-- CreateIndex
CREATE INDEX "CfEnrollmentStatusHistory_enrollmentId_createdAt_idx" ON "CfEnrollmentStatusHistory"("enrollmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CfIntakeSubmission_formAssignmentId_key" ON "CfIntakeSubmission"("formAssignmentId");

-- CreateIndex
CREATE INDEX "CfIntakeSubmission_organizationId_clientId_idx" ON "CfIntakeSubmission"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfIntakeSubmission_organizationId_isDemo_idx" ON "CfIntakeSubmission"("organizationId", "isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "CfIntakeSubmission_organizationId_idempotencyKey_key" ON "CfIntakeSubmission"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CfIntakeRenderSession_configurationToken_key" ON "CfIntakeRenderSession"("configurationToken");

-- CreateIndex
CREATE INDEX "CfIntakeRenderSession_organizationId_formAssignmentId_idx" ON "CfIntakeRenderSession"("organizationId", "formAssignmentId");

-- CreateIndex
CREATE INDEX "CfIntakeRenderSession_expiresAt_idx" ON "CfIntakeRenderSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CfIntakeSubmissionSnapshot_intakeSubmissionId_key" ON "CfIntakeSubmissionSnapshot"("intakeSubmissionId");

-- CreateIndex
CREATE INDEX "CfIntakeSubmissionSnapshot_organizationId_idx" ON "CfIntakeSubmissionSnapshot"("organizationId");

-- CreateIndex
CREATE INDEX "CfIntakeSubmissionProgram_organizationId_programId_idx" ON "CfIntakeSubmissionProgram"("organizationId", "programId");

-- CreateIndex
CREATE INDEX "CfIntakeSubmissionProgram_enrollmentId_idx" ON "CfIntakeSubmissionProgram"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CfIntakeSubmissionProgram_intakeSubmissionId_programId_key" ON "CfIntakeSubmissionProgram"("intakeSubmissionId", "programId");

-- CreateIndex
CREATE INDEX "CfTask_organizationId_enrollmentId_idx" ON "CfTask"("organizationId", "enrollmentId");

-- CreateIndex
CREATE INDEX "CfTask_organizationId_clientId_idx" ON "CfTask"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfTask_organizationId_isDemo_idx" ON "CfTask"("organizationId", "isDemo");

-- CreateIndex
CREATE INDEX "CfTask_dueDate_idx" ON "CfTask"("dueDate");
