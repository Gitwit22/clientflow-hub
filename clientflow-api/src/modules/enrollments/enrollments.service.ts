import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isPrismaUniqueViolation } from '../../common/prisma-errors';

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

  /** Shared creation: enrollment + status history + ENROLLMENT_CREATED activity, one transaction. */
  private async createEnrollment(input: CreateEnrollmentArgs) {
    return this.prisma.$transaction(async (transaction) => {
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
    });
  }
}
