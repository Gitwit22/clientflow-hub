import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/clientflow';
import type { TenantDb } from '../../common/tenancy/org-scoped.repository';

/**
 * Enrollment state machine. Every status change (staff transition, automation, contract send and
 * signing) goes through `transitionEnrollment`, which applies the change only if the enrollment is
 * still in the state it was read in, so two concurrent changes can't both win.
 */
export const ENROLLMENT_STATUSES = [
  'interested',
  'pending_review',
  'approved',
  'onboarding',
  'active',
  'on_hold',
  'completed',
  'declined',
  'withdrawn',
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ENROLLMENT_TRANSITIONS: Record<EnrollmentStatus, readonly EnrollmentStatus[]> = {
  interested: ['pending_review', 'approved', 'onboarding', 'active', 'declined', 'withdrawn'],
  pending_review: ['approved', 'onboarding', 'declined', 'withdrawn'],
  approved: ['onboarding', 'active', 'on_hold', 'withdrawn'],
  onboarding: ['active', 'on_hold', 'withdrawn'],
  active: ['on_hold', 'completed', 'withdrawn'],
  on_hold: ['active', 'completed', 'withdrawn'],
  completed: [],
  declined: [],
  // Constrained: a withdrawn member may only be reinstated by staff, never by automation or signing.
  withdrawn: ['active'],
};

/** Closed enrollments: nothing (signing, contracts, forms, billing) may act on them. */
export const CLOSED_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['completed', 'declined', 'withdrawn'];

export function isEnrollmentStatus(value: unknown): value is EnrollmentStatus {
  return typeof value === 'string' && (ENROLLMENT_STATUSES as readonly string[]).includes(value);
}

export function isClosedEnrollment(status: string): boolean {
  return (CLOSED_ENROLLMENT_STATUSES as readonly string[]).includes(status);
}

export function canTransitionEnrollment(from: string, to: string, options: { byStaff?: boolean } = {}): boolean {
  if (!isEnrollmentStatus(from) || !isEnrollmentStatus(to)) return false;
  if (from === 'withdrawn' && !options.byStaff) return false;
  return ENROLLMENT_TRANSITIONS[from].includes(to);
}

export function assertEnrollmentTransition(from: string, to: string, options: { byStaff?: boolean } = {}): void {
  if (!isEnrollmentStatus(to)) throw new BadRequestException(`Unknown enrollment status: ${to}.`);
  if (!canTransitionEnrollment(from, to, options)) {
    throw new BadRequestException(`Enrollment cannot transition from ${from} to ${to}.`);
  }
}

/**
 * Applies a validated transition as a conditional update: it only succeeds if the enrollment is
 * still `from`. A concurrent change makes it throw 409 instead of silently overwriting.
 */
export async function transitionEnrollment(
  db: TenantDb,
  input: {
    organizationId: string;
    enrollmentId: string;
    from: string;
    to: EnrollmentStatus;
    byStaff?: boolean;
    data?: Omit<Prisma.CfProgramEnrollmentUpdateManyMutationInput, 'status'>;
    history: { changedByUserId: string | null; changedByDisplayName: string; reason?: string | null };
  },
): Promise<void> {
  assertEnrollmentTransition(input.from, input.to, { byStaff: input.byStaff });
  const result = await db.cfProgramEnrollment.updateMany({
    where: { id: input.enrollmentId, organizationId: input.organizationId, status: input.from as EnrollmentStatus },
    data: { ...(input.data ?? {}), status: input.to },
  });
  if (result.count !== 1) {
    throw new ConflictException('This enrollment was changed by someone else. Refresh and try again.');
  }
  await db.cfEnrollmentStatusHistory.create({
    data: {
      organizationId: input.organizationId,
      enrollmentId: input.enrollmentId,
      previousStatus: input.from as EnrollmentStatus,
      newStatus: input.to,
      changedByUserId: input.history.changedByUserId,
      changedByDisplayName: input.history.changedByDisplayName,
      reason: input.history.reason ?? null,
    },
  });
}
