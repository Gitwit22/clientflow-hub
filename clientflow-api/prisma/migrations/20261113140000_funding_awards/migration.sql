-- Funding awards: money a program pays OUT to a client (separate from billing, which records money
-- the client pays). Additive only: two new tables and one nullable column.

-- CreateTable
CREATE TABLE "CfEnrollmentAward" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "amountAwarded" DECIMAL(10,2) NOT NULL,
    "awardDate" TIMESTAMP(3) NOT NULL,
    "expectedPaymentDate" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "agreementTemplateId" TEXT,
    "currentAgreementId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedByDisplayName" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledByDisplayName" TEXT,
    "cancelReason" TEXT,
    "createdByUserId" TEXT,
    "createdByDisplayName" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfEnrollmentAward_pkey" PRIMARY KEY ("id"),
    -- An award is always for a positive amount.
    CONSTRAINT "CfEnrollmentAward_amountAwarded_positive" CHECK ("amountAwarded" > 0),
    CONSTRAINT "CfEnrollmentAward_status_known" CHECK ("status" IN ('pending', 'approved', 'agreement_sent', 'agreement_signed', 'cancelled'))
);

-- CreateTable
CREATE TABLE "CfAwardPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "awardId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" "CfPaymentMethod" NOT NULL,
    "note" TEXT,
    "recordedByUserId" TEXT,
    "recordedByDisplayName" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidedByDisplayName" TEXT,
    "voidReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CfAwardPayment_pkey" PRIMARY KEY ("id"),
    -- A payment is always a positive amount; corrections are voids, never negative rows.
    CONSTRAINT "CfAwardPayment_amount_positive" CHECK ("amount" > 0)
);

-- AlterTable
ALTER TABLE "CfDocument" ADD COLUMN "awardId" TEXT;

-- AlterTable: an award agreement records which award it belongs to.
ALTER TABLE "CfContract" ADD COLUMN "awardId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CfEnrollmentAward_organizationId_idempotencyKey_key" ON "CfEnrollmentAward"("organizationId", "idempotencyKey");
CREATE INDEX "CfEnrollmentAward_organizationId_enrollmentId_idx" ON "CfEnrollmentAward"("organizationId", "enrollmentId");
CREATE INDEX "CfEnrollmentAward_organizationId_clientId_idx" ON "CfEnrollmentAward"("organizationId", "clientId");
CREATE INDEX "CfEnrollmentAward_organizationId_status_idx" ON "CfEnrollmentAward"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CfAwardPayment_organizationId_idempotencyKey_key" ON "CfAwardPayment"("organizationId", "idempotencyKey");
CREATE INDEX "CfAwardPayment_organizationId_awardId_idx" ON "CfAwardPayment"("organizationId", "awardId");
CREATE INDEX "CfAwardPayment_organizationId_enrollmentId_idx" ON "CfAwardPayment"("organizationId", "enrollmentId");
CREATE INDEX "CfAwardPayment_organizationId_clientId_idx" ON "CfAwardPayment"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CfDocument_organizationId_awardId_idx" ON "CfDocument"("organizationId", "awardId");
CREATE INDEX "CfContract_organizationId_awardId_idx" ON "CfContract"("organizationId", "awardId");
