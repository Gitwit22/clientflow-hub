import { NotFoundException } from '@nestjs/common';
import type { TenantDb } from '../../common/tenancy/org-scoped.repository';
import { applyEnrollmentClosure } from './enrollment-closure';
import { canTransitionEnrollment, isClosedEnrollment, transitionEnrollment, type EnrollmentStatus } from './enrollment-state';

/**
 * How a client's participation in a program ended, chosen when a final report is finalized.
 * Finishing outcomes close the enrollment as completed; early endings close it as withdrawn.
 */
export const FINISHED_OUTCOMES = [
  'Program Complete',
  'Contract Complete',
  'Paid in Full',
  'Grant Requirements Complete',
  'Sponsorship Fulfilled',
] as const;
export const EARLY_OUTCOMES = ['Closed Early', 'Defaulted'] as const;
export const PROGRAM_OUTCOMES: readonly string[] = [...FINISHED_OUTCOMES, ...EARLY_OUTCOMES];

export function isProgramOutcome(value: unknown): value is string {
  return typeof value === 'string' && PROGRAM_OUTCOMES.includes(value);
}

export interface ParticipationArchive {
  enrollmentId: string;
  previousStatus: string;
  status: string;
}

/**
 * Archives one client's participation in one program when its final report is finalized.
 *
 * Only that enrollment changes: it closes (completed or withdrawn, through the state machine), so
 * its open contracts, unfinished forms and billing agreement end and no new monthly checklist
 * starts, and it is marked archived. The client record and their other enrollments are untouched;
 * archiving the whole client is a separate action.
 */
export async function archiveProgramParticipation(
  db: TenantDb,
  input: {
    organizationId: string;
    clientId: string;
    enrollmentId: string;
    outcome: string;
    actor: { id: string | null; name: string };
  },
  now = new Date(),
): Promise<ParticipationArchive> {
  const enrollment = await db.cfProgramEnrollment.findFirst({
    where: { id: input.enrollmentId, organizationId: input.organizationId, clientId: input.clientId },
  });
  if (!enrollment) throw new NotFoundException('Enrollment not found.');

  const previousStatus: string = enrollment.status;
  let status: string = previousStatus;
  if (!isClosedEnrollment(status)) {
    const wanted: Extract<EnrollmentStatus, 'completed' | 'withdrawn'> =
      (FINISHED_OUTCOMES as readonly string[]).includes(input.outcome) ? 'completed' : 'withdrawn';
    // An enrollment that never became active cannot be "completed"; it still ends, as withdrawn.
    const target = canTransitionEnrollment(status, wanted, { byStaff: true }) ? wanted : 'withdrawn';
    if (canTransitionEnrollment(status, target, { byStaff: true })) {
      await transitionEnrollment(db, {
        organizationId: input.organizationId,
        enrollmentId: enrollment.id,
        from: previousStatus,
        to: target,
        byStaff: true,
        data: target === 'completed' ? { completedAt: now } : { withdrawnAt: now },
        history: {
          changedByUserId: input.actor.id,
          changedByDisplayName: input.actor.name,
          reason: `Final report finalized: ${input.outcome}.`,
        },
      });
      status = target;
    }
  }
  await applyEnrollmentClosure(db, { ...enrollment, status }, now);
  await db.cfProgramEnrollment.updateMany({
    where: { id: enrollment.id, organizationId: input.organizationId, isArchived: false },
    data: { isArchived: true, archivedAt: now },
  });
  return { enrollmentId: enrollment.id, previousStatus, status };
}
