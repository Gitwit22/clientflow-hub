-- A program deliverable can complete itself when something happens for the client (a form is
-- submitted, a payment recorded, the agreement signed, a document uploaded, a check-in recorded).
-- Null means it is completed by staff only, as before. Additive only.

-- AlterTable
ALTER TABLE "CfProgramDeliverableTemplate" ADD COLUMN "completeOn" TEXT,
ADD COLUMN "completeOnFormId" TEXT;
