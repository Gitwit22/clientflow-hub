import type { TenantDb } from '../../common/tenancy/org-scoped.repository';
import { applyEnrollmentClosure } from './enrollment-closure';
import { canTransitionEnrollment, transitionEnrollment, type EnrollmentStatus } from './enrollment-state';

/**
 * What a final report's archive decision does. Completion outcomes complete the enrollment, early
 * endings withdraw it, "Archived" archives the client (and their enrollments), and "Pre-Archive"
 * only records the report. Enrollment changes go through the state machine, so a decision never
 * forces an illegal transition (for example, completing an enrollment that never became active).
 */
const COMPLETES_ENROLLMENT = new Set([
  'Contract Complete',
  'Program Complete',
  'Paid in Full',
  'Grant Requirements Complete',
  'Sponsorship Fulfilled',
]);
const WITHDRAWS_ENROLLMENT = new Set(['Closed Early', 'Defaulted']);

export type FinalReportOutcome =
  | { applied: 'completed' | 'withdrawn'; enrollmentId: string }
  | { applied: 'archived' }
  | { applied: null; reason: 'recorded_only' | 'no_enrollment' | 'transition_not_allowed' };

export function enrollmentTargetForDecision(decision: string): Extract<EnrollmentStatus, 'completed' | 'withdrawn'> | null {
  if (COMPLETES_ENROLLMENT.has(decision)) return 'completed';
  if (WITHDRAWS_ENROLLMENT.has(decision)) return 'withdrawn';
  return null;
}

export async function applyFinalReportDecision(
  db: TenantDb,
  input: {
    organizationId: string;
    clientId: string;
    enrollmentId: string | null;
    decision: string;
    actor: { id: string | null; name: string };
  },
  now = new Date(),
): Promise<FinalReportOutcome> {
  if (input.decision === 'Archived') {
    await db.cfClient.updateMany({
      where: { id: input.clientId, organizationId: input.organizationId, isArchived: false },
      data: { isArchived: true, archivedAt: now, archiveReason: 'Final report completed', finalStatus: 'Archived' },
    });
    await db.cfProgramEnrollment.updateMany({
      where: { organizationId: input.organizationId, clientId: input.clientId, isArchived: false },
      data: { isArchived: true, archivedAt: now },
    });
    return { applied: 'archived' };
  }

  const target = enrollmentTargetForDecision(input.decision);
  if (!target) return { applied: null, reason: 'recorded_only' };
  if (!input.enrollmentId) return { applied: null, reason: 'no_enrollment' };

  const enrollment = await db.cfProgramEnrollment.findFirst({
    where: { id: input.enrollmentId, organizationId: input.organizationId, clientId: input.clientId },
  });
  if (!enrollment || !canTransitionEnrollment(enrollment.status, target, { byStaff: true })) {
    return { applied: null, reason: 'transition_not_allowed' };
  }
  await transitionEnrollment(db, {
    organizationId: input.organizationId,
    enrollmentId: enrollment.id,
    from: enrollment.status,
    to: target,
    byStaff: true,
    data: target === 'completed' ? { completedAt: now } : { withdrawnAt: now },
    history: {
      changedByUserId: input.actor.id,
      changedByDisplayName: input.actor.name,
      reason: `Final report: ${input.decision}.`,
    },
  });
  await applyEnrollmentClosure(db, { ...enrollment, status: target }, now);
  return { applied: target, enrollmentId: enrollment.id };
}
