CREATE TYPE "CfBillingFrequency" AS ENUM ('one_time', 'weekly', 'monthly', 'quarterly', 'annually', 'custom');
CREATE TYPE "CfBillingAgreementStatus" AS ENUM ('active', 'ended');
CREATE TYPE "CfPaymentMethod" AS ENUM ('cash', 'check', 'ach', 'card', 'other');
CREATE TYPE "CfPaymentSource" AS ENUM ('manual', 'legacy_backfill');

CREATE TABLE "CfProgramBillingConfig" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "defaultAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "frequency" "CfBillingFrequency" NOT NULL DEFAULT 'monthly',
  "customIntervalDays" INTEGER,
  "billingRequired" BOOLEAN NOT NULL DEFAULT true,
  "defaultDueDay" INTEGER,
  "allowCustomClientPricing" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfProgramBillingConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CfProgramBillingConfig_organizationId_programId_key" ON "CfProgramBillingConfig"("organizationId", "programId");
CREATE INDEX "CfProgramBillingConfig_organizationId_programId_idx" ON "CfProgramBillingConfig"("organizationId", "programId");

CREATE TABLE "CfEnrollmentBillingAgreement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "frequency" "CfBillingFrequency" NOT NULL,
  "customIntervalDays" INTEGER,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "defaultDueDay" INTEGER,
  "status" "CfBillingAgreementStatus" NOT NULL DEFAULT 'active',
  "nextDueDate" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdByDisplayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CfEnrollmentBillingAgreement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CfEnrollmentBillingAgreement_organizationId_enrollmentId_stat_idx" ON "CfEnrollmentBillingAgreement"("organizationId", "enrollmentId", "status");

-- Enforces at most one active billing agreement per enrollment. Prisma's schema DSL cannot
-- express a partial/filtered unique index, so this is hand-written directly in the migration.
-- Financial-term changes never UPDATE this row; they end it (status = 'ended') and insert a new one.
CREATE UNIQUE INDEX "CfEnrollmentBillingAgreement_enrollmentId_active_key" ON "CfEnrollmentBillingAgreement"("enrollmentId") WHERE "status" = 'active';

CREATE TABLE "CfPaymentRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "billingAgreementId" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "paymentDate" TIMESTAMP(3) NOT NULL,
  "paymentMethod" "CfPaymentMethod" NOT NULL,
  "billingPeriodStart" TIMESTAMP(3) NOT NULL,
  "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
  "source" "CfPaymentSource" NOT NULL DEFAULT 'manual',
  "note" TEXT,
  "recordedByUserId" TEXT,
  "recordedByDisplayName" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidedByUserId" TEXT,
  "voidedByDisplayName" TEXT,
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfPaymentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CfPaymentRecord_organizationId_enrollmentId_paymentDate_idx" ON "CfPaymentRecord"("organizationId", "enrollmentId", "paymentDate");
CREATE INDEX "CfPaymentRecord_organizationId_billingPeriodStart_billingPer_idx" ON "CfPaymentRecord"("organizationId", "billingPeriodStart", "billingPeriodEnd");
CREATE INDEX "CfPaymentRecord_organizationId_billingAgreementId_idx" ON "CfPaymentRecord"("organizationId", "billingAgreementId");

-- Prevents duplicate historical confirmations if the "Bring Account Current" backfill endpoint
-- is called twice for the same period. Ordinary manual payments are intentionally unconstrained,
-- since partial/multiple payments within one billing period are a supported case.
CREATE UNIQUE INDEX "CfPaymentRecord_backfill_period_key" ON "CfPaymentRecord"("enrollmentId", "billingPeriodStart", "billingPeriodEnd") WHERE "source" = 'legacy_backfill' AND "voidedAt" IS NULL;
