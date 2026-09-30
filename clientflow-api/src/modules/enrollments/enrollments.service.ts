import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { findClientForOrg, findProgramForOrg, type TenantDb } from '../../common/tenancy/org-scoped.repository';
import { isPrismaUniqueViolation } from '../../common/prisma-errors';

/** Enrollment statuses considered closed — assignment changes should no longer cascade to these. */
const TERMINAL_ENROLLMENT_STATUSES = ['completed', 'declined', 'withdrawn'];

/** Mirrors compatibility.controller.ts's progressForEnrollmentStatus() for the one status this service creates directly. */
const INITIAL_ENROLLMENT_PROGRESS_PERCENTAGE = 10;

export interface EnsureEnrollmentInput {
  organizationId: string;
  clientId: string;
  programId: string;
  programName: string;
  assignedUserId?: string | null;
  assignedStaff?: string | null;
  actorUserId?: string | null;
  actorDisplayName: string;
  isDemo?: boolean;
}

export interface CreateManualEnrollmentInput {
  organizationId: string;
  clientId: string;
  programId: string;
  status: string;
  assignedUserId?: string | null;
  assignedStaff?: string | null;
  lastModifiedByUserId?: string | null;
  lastModifiedByDisplayName?: string | null;
  startDate?: Date | null;
  nextAction?: string | null;
  nextActionDate?: Date | null;
  progressPercentage: number;
  currentGoalId?: string | null;
  clientResponsiveness?: string;
  currentBlockers?: string | null;
  riskLevel?: string;
  staffProgressNotes?: string | null;
  meetingsAttended?: number;
  outcomeAchieved?: string;
  finalOutcomeSummary?: string | null;
  completedAt?: Date | null;
  withdrawnAt?: Date | null;
  onHoldReason?: string | null;
  actorUserId: string;
  actorDisplayName: string;
}

interface CreateEnrollmentArgs {
  organizationId: string;
  clientId: string;
  programId: string;
  status: string;
  assignedUserId?: string | null;
  assignedStaff?: string | null;
  lastModifiedByUserId?: string | null;
  lastModifiedByDisplayName?: string | null;
  startDate?: Date | null;
  nextAction?: string | null;
  nextActionDate?: Date | null;
  progressPercentage?: number;
  currentGoalId?: string | null;
  clientResponsiveness?: string;
  currentBlockers?: string | null;
  riskLevel?: string;
  staffProgressNotes?: string | null;
  meetingsAttended?: number;
  outcomeAchieved?: string;
  finalOutcomeSummary?: string | null;
  completedAt?: Date | null;
  withdrawnAt?: Date | null;
  onHoldReason?: string | null;
  isDemo?: boolean;
  actorUserId: string | null;
  actorDisplayName: string;
  activityDescription: string;
  statusHistoryReason: string;
}

/**
 * The single authority for how a CfProgramEnrollment may legally exist: creation, status
 * history, the ENROLLMENT_CREATED activity event, and uniqueness/race handling all live here.
 * Callers decide *why* an enrollment is being created (automation default vs. staff manual
 * add); this service decides *how* one may exist.
 */
@Injectable()
export class EnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent default enrollment, used by program automation and the Master Intake flow. */
  async ensureEnrollment(input: EnsureEnrollmentInput): Promise<{ enrollmentId: string; created: boolean }> {
    const existing = await this.prisma.cfProgramEnrollment.findFirst({
      where: { organizationId: input.organizationId, clientId: input.clientId, programId: input.programId },
    });
    if (existing) return { enrollmentId: existing.id, created: false };

    try {
      const enrollment = await this.createEnrollment({
        organizationId: input.organizationId,
        clientId: input.clientId,
        programId: input.programId,
        status: 'interested',
        assignedUserId: input.assignedUserId ?? null,
        assignedStaff: input.assignedStaff ?? null,
        lastModifiedByUserId: input.actorUserId ?? null,
        lastModifiedByDisplayName: input.actorDisplayName,
        progressPercentage: INITIAL_ENROLLMENT_PROGRESS_PERCENTAGE,
        isDemo: input.isDemo ?? false,
        actorUserId: input.actorUserId ?? null,
        actorDisplayName: input.actorDisplayName,
        activityDescription: `Enrolled in ${input.programName}.`,
        statusHistoryReason: 'Created by program automation.',
      });
      return { enrollmentId: enrollment.id, created: true };
    } catch (error) {
      // Two concurrent requests can both miss the initial findFirst; the DB's
      // [clientId, programId] unique constraint is the real source of truth here.
      if (!isPrismaUniqueViolation(error)) throw error;
      const concurrent = await this.prisma.cfProgramEnrollment.findFirst({
        where: { organizationId: input.organizationId, clientId: input.clientId, programId: input.programId },
        select: { id: true },
      });
      if (!concurrent) throw error;
      return { enrollmentId: concurrent.id, created: false };
    }
  }

  /** Staff-initiated enrollment with fully specified initial values (admin "add to program"). */
  async createManualEnrollment(input: CreateManualEnrollmentInput) {
    return this.createEnrollment({
      ...input,
      isDemo: false,
      activityDescription: `Enrollment created with status ${input.status}.`,
      statusHistoryReason: 'Enrollment created.',
    });
  }

  /**
   * A client's assignedUserId/assignedStaff is otherwise only snapshotted once at enrollment
   * creation and never resynced — call this after a client-level assignment change so their
   * still-open enrollments (not completed/declined/withdrawn) reflect the new assignee too.
   */
  async syncAssignmentToActiveEnrollments(
    organizationId: string,
    clientId: string,
    assignedUserId: string | null,
    assignedStaff: string | null,
  ): Promise<void> {
    await this.prisma.cfProgramEnrollment.updateMany({
      where: {
        organizationId,
        clientId,
        status: { notIn: TERMINAL_ENROLLMENT_STATUSES as any },
      },
      data: { assignedUserId, assignedStaff },
    });
  }

  /**
   * ensureEnrollment inside a caller's transaction (the intake submission): the enrollment, its
   * history and activity commit or roll back together with everything else the caller writes.
   */
  async ensureEnrollmentWithin(
    transaction: TenantDb,
    input: EnsureEnrollmentInput & { statusHistoryReason?: string },
  ): Promise<{ enrollmentId: string; created: boolean; status: string }> {
    const existing = await transaction.cfProgramEnrollment.findFirst({
      where: { organizationId: input.organizationId, clientId: input.clientId, programId: input.programId },
      select: { id: true, status: true },
    });
    if (existing) return { enrollmentId: existing.id, created: false, status: existing.status };
    const enrollment = await this.createEnrollmentIn(transaction, {
      organizationId: input.organizationId,
      clientId: input.clientId,
      programId: input.programId,
      status: 'interested',
      assignedUserId: input.assignedUserId ?? null,
      assignedStaff: input.assignedStaff ?? null,
      lastModifiedByUserId: input.actorUserId ?? null,
      lastModifiedByDisplayName: input.actorDisplayName,
      progressPercentage: INITIAL_ENROLLMENT_PROGRESS_PERCENTAGE,
      isDemo: input.isDemo ?? false,
      actorUserId: input.actorUserId ?? null,
      actorDisplayName: input.actorDisplayName,
      activityDescription: `Enrolled in ${input.programName}.`,
      statusHistoryReason: input.statusHistoryReason ?? 'Created by program automation.',
    });
    return { enrollmentId: enrollment.id, created: true, status: enrollment.status };
  }

  /** Shared creation: enrollment + status history + ENROLLMENT_CREATED activity, one transaction. */
  private async createEnrollment(input: CreateEnrollmentArgs) {
    return this.prisma.$transaction((transaction) => this.createEnrollmentIn(transaction, input));
  }

  private async createEnrollmentIn(transaction: TenantDb, input: CreateEnrollmentArgs) {
    // Both ids must belong to the organization: a foreign client or program is a 404, and can
    // never occupy the global [clientId, programId] slot for another organization.
    await findClientForOrg(transaction, input.organizationId, input.clientId, { includeArchived: true });
    await findProgramForOrg(transaction, input.organizationId, input.programId);
    const enrollment = await transaction.cfProgramEnrollment.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        programId: input.programId,
        status: input.status as any,
        assignedUserId: input.assignedUserId ?? null,
        assignedStaff: input.assignedStaff ?? null,
        lastModifiedByUserId: input.lastModifiedByUserId ?? null,
        lastModifiedByDisplayName: input.lastModifiedByDisplayName ?? null,
        startDate: input.startDate ?? null,
        nextAction: input.nextAction ?? null,
        nextActionDate: input.nextActionDate ?? null,
        ...(input.progressPercentage !== undefined ? { progressPercentage: input.progressPercentage } : {}),
        currentGoalId: input.currentGoalId ?? null,
        lastProgressUpdate: new Date(),
        ...(input.clientResponsiveness !== undefined ? { clientResponsiveness: input.clientResponsiveness as any } : {}),
        currentBlockers: input.currentBlockers ?? null,
        ...(input.riskLevel !== undefined ? { riskLevel: input.riskLevel as any } : {}),
        staffProgressNotes: input.staffProgressNotes ?? null,
        ...(input.meetingsAttended !== undefined ? { meetingsAttended: input.meetingsAttended } : {}),
        ...(input.outcomeAchieved !== undefined ? { outcomeAchieved: input.outcomeAchieved as any } : {}),
        finalOutcomeSummary: input.finalOutcomeSummary ?? null,
        completedAt: input.completedAt ?? null,
        withdrawnAt: input.withdrawnAt ?? null,
        onHoldReason: input.onHoldReason ?? null,
        isDemo: input.isDemo ?? false,
      } as any,
    });

    await transaction.cfEnrollmentStatusHistory.create({
      data: {
        organizationId: input.organizationId,
        enrollmentId: enrollment.id,
        previousStatus: null,
        newStatus: enrollment.status,
        changedByUserId: input.actorUserId,
        changedByDisplayName: input.actorDisplayName,
        reason: input.statusHistoryReason,
      },
    });

    await transaction.cfActivityLog.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        enrollmentId: enrollment.id,
        actorUserId: input.actorUserId,
        action: 'ENROLLMENT_CREATED',
        description: input.activityDescription,
        user: input.actorDisplayName,
        isDemo: input.isDemo ?? false,
      },
    });

    return enrollment;
  }
}
