/**
 * Every table that holds a client's data, and the key it is found by. Permanent deletion walks this
 * list in order (children before the rows they point at), inside one transaction.
 *
 * `client-deletion.manifest.spec.ts` reads the Prisma schema and fails when a model has a
 * clientId / enrollmentId / formAssignmentId / intakeSubmissionId / billingAgreementId column that
 * is neither listed here nor in NOT_CLIENT_OWNED, so a new table can't be forgotten silently.
 */
export type ClientDataKey =
  | 'clientId'
  | 'enrollmentId'
  | 'formAssignmentId'
  | 'intakeSubmissionId'
  | 'billingAgreementId'
  /** Any id of the client's own rows (client, enrollments, contracts, forms, submissions, documents). */
  | 'anyOwnedId';

/** Prisma delegate names (camelCase model names) for the tables below. */
export type ClientOwnedModel =
  | 'cfPaymentRecord'
  | 'cfEnrollmentBillingAgreement'
  | 'cfEnrollmentDeliverable'
  | 'cfEnrollmentDeliverableCycle'
  | 'cfEnrollmentMonitoringEvidence'
  | 'cfEnrollmentMonitoringHistory'
  | 'cfEnrollmentMonitoring'
  | 'cfEnrollmentCheckpointEvidence'
  | 'cfEnrollmentProgressCheckpoint'
  | 'cfEnrollmentProgressTrack'
  | 'cfEnrollmentProgressPlan'
  | 'cfEnrollmentGoal'
  | 'cfEnrollmentStatusHistory'
  | 'cfIntakeSubmissionProgram'
  | 'cfIntakeSubmissionSnapshot'
  | 'cfIntakeRenderSession'
  | 'cfIntakeSubmission'
  | 'cfTask'
  | 'cfMonitoringTask'
  | 'cfCommunication'
  | 'cfActivityLog'
  | 'cfNotification'
  | 'cfFinalReport'
  | 'cfProgramAutomationExecution'
  | 'cfDocumentAssignment'
  | 'cfTerms'
  | 'cfFormAssignment'
  | 'cfContract'
  | 'cfDocument'
  | 'cfProgramEnrollment';

export interface ClientDeletionStep {
  model: ClientOwnedModel;
  /** Which of the client's ids to match. */
  by: ClientDataKey;
  /** The column to match them against, when it isn't named like the key. */
  column?: string;
}

/**
 * Deletion order. Billing comes first: a permanently deleted client's payments and agreements are
 * erased with them (an archived client keeps them). Contracts and documents go before the stored
 * files they point at, which the deletion service removes after this list, then the client itself.
 */
export const CLIENT_DELETION_STEPS: readonly ClientDeletionStep[] = [
  // Money.
  { model: 'cfPaymentRecord', by: 'enrollmentId' },
  { model: 'cfPaymentRecord', by: 'billingAgreementId' },
  { model: 'cfEnrollmentBillingAgreement', by: 'enrollmentId' },
  // Enrollment detail.
  { model: 'cfEnrollmentDeliverable', by: 'enrollmentId' },
  { model: 'cfEnrollmentDeliverableCycle', by: 'enrollmentId' },
  { model: 'cfEnrollmentMonitoringEvidence', by: 'enrollmentId' },
  { model: 'cfEnrollmentMonitoringHistory', by: 'enrollmentId' },
  { model: 'cfEnrollmentMonitoring', by: 'enrollmentId' },
  { model: 'cfEnrollmentCheckpointEvidence', by: 'enrollmentId' },
  { model: 'cfEnrollmentProgressCheckpoint', by: 'enrollmentId' },
  { model: 'cfEnrollmentProgressTrack', by: 'enrollmentId' },
  { model: 'cfEnrollmentProgressPlan', by: 'enrollmentId' },
  { model: 'cfEnrollmentGoal', by: 'enrollmentId' },
  { model: 'cfEnrollmentStatusHistory', by: 'enrollmentId' },
  // Intake.
  { model: 'cfIntakeSubmissionProgram', by: 'intakeSubmissionId' },
  { model: 'cfIntakeSubmissionProgram', by: 'enrollmentId' },
  { model: 'cfIntakeSubmissionSnapshot', by: 'intakeSubmissionId' },
  { model: 'cfIntakeRenderSession', by: 'formAssignmentId' },
  { model: 'cfIntakeSubmission', by: 'clientId' },
  // Everything else keyed by the client.
  { model: 'cfTask', by: 'clientId' },
  { model: 'cfMonitoringTask', by: 'clientId' },
  { model: 'cfCommunication', by: 'clientId' },
  { model: 'cfActivityLog', by: 'clientId' },
  { model: 'cfNotification', by: 'clientId' },
  { model: 'cfNotification', by: 'intakeSubmissionId', column: 'submissionId' },
  // Staff notifications about the client's rows can name them even without a clientId.
  { model: 'cfNotification', by: 'anyOwnedId', column: 'sourceId' },
  { model: 'cfFinalReport', by: 'clientId' },
  { model: 'cfProgramAutomationExecution', by: 'clientId' },
  { model: 'cfDocumentAssignment', by: 'clientId' },
  { model: 'cfTerms', by: 'clientId' },
  { model: 'cfFormAssignment', by: 'clientId' },
  { model: 'cfContract', by: 'clientId' },
  { model: 'cfDocument', by: 'clientId' },
  { model: 'cfProgramEnrollment', by: 'clientId' },
];

/**
 * Models that carry one of the keys above but are not the client's data. Each needs a reason; the
 * completeness spec fails on any model with such a key that is in neither list.
 */
export const NOT_CLIENT_OWNED: Readonly<Record<string, string>> = {};
