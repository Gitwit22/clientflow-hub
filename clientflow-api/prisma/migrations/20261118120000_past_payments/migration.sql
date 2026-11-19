-- Past payments: a payment the client made before (or outside) ClientFlow's billing schedule, recorded
-- with its real date and no billing agreement or period. Regular payments keep both: the CHECK
-- constraint below allows the missing agreement/period only for source 'historical'. Additive only.

-- AlterEnum
ALTER TYPE "CfPaymentSource" ADD VALUE 'historical';

-- AlterTable
ALTER TABLE "CfPaymentRecord" ALTER COLUMN "billingAgreementId" DROP NOT NULL,
ALTER COLUMN "billingPeriodStart" DROP NOT NULL,
ALTER COLUMN "billingPeriodEnd" DROP NOT NULL;

-- A payment without an agreement or period must be a past payment; every other payment keeps both.
ALTER TABLE "CfPaymentRecord" ADD CONSTRAINT "CfPaymentRecord_agreement_or_historical_check"
  CHECK (
    ("billingAgreementId" IS NOT NULL AND "billingPeriodStart" IS NOT NULL AND "billingPeriodEnd" IS NOT NULL)
    OR "source"::text = 'historical'
  );
