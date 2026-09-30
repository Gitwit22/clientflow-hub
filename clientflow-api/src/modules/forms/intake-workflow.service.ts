import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/clientflow';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramAutomationService } from '../automation/program-automation.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { CLIENT_STATUS, FORM_STATUS } from './intake-lifecycle';
import { assertPublicFormLinkUsable, PUBLIC_FORM_ALREADY_SUBMITTED, resolvePublicFormLink } from './public-form-link';

export interface IntakeSubmissionInput {
  /** Answers to the core form, keyed by field id. Stored flat on the assignment. */
  coreResponses: Record<string, unknown>;
  /** Answers to each selected program's section, keyed by program id. */
  programResponses?: Record<string, Record<string, unknown>>;
  selectedProgramIds?: string[];
  /** Ties the submission to the rendered form the client saw (`GET /s/:token`). */
  configurationToken?: string;
  /** Sent by the client so a retried request is recognised as the same submission. */
  idempotencyKey?: string;
  /** Who submitted (activity/automation attribution). */
  actorDisplayName?: string;
}

export interface IntakeSubmissionResult {
  success: true;
  submissionId: string;
  clientId: string;
  assignmentId: string;
  enrollmentIds: string[];
  automation: unknown;
  /** True when this request repeated a submission that had already been recorded. */
  replayed?: true;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The single way an intake form is submitted, whichever public route it arrives on.
 *
 * Everything that records the submission happens in one transaction: the form is claimed (only once),
 * enrollments are created or reused with their status history, the submission and each program's
 * answers are stored, and the client is updated. A retry of a submission that already committed
 * returns the recorded result instead of creating anything again. Notifications and automation run
 * only after the commit, keyed by the submission id.
 */
@Injectable()
export class IntakeWorkflowService {
  private readonly logger = new Logger(IntakeWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService,
    private readonly automation?: ProgramAutomationService,
  ) {}

  async submit(rawToken: string, input: IntakeSubmissionInput): Promise<IntakeSubmissionResult> {
    // 'view' first: a submitted link must still resolve so a retry can be answered from the record.
    const { assignment, client } = await resolvePublicFormLink(this.prisma, rawToken, 'view');
    const coreResponses = isRecord(input.coreResponses) ? input.coreResponses : {};
    const programResponses = isRecord(input.programResponses) ? input.programResponses : {};
    const selectedProgramIds = [...new Set((input.selectedProgramIds ?? []).filter((id) => typeof id === 'string' && id))];
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ coreResponses, programResponses, selectedProgramIds }))
      .digest('hex');
    const idempotencyKey = `${assignment.id}:${input.idempotencyKey ?? 'submission'}`;

    const recorded = await this.prisma.cfIntakeSubmission.findFirst({
      where: { organizationId: assignment.organizationId, formAssignmentId: assignment.id },
    });
    if (recorded) {
      if (recorded.requestHash === requestHash || recorded.idempotencyKey === idempotencyKey) return this.replay(recorded, assignment.id);
      throw new ConflictException(PUBLIC_FORM_ALREADY_SUBMITTED);
    }
    assertPublicFormLinkUsable(assignment, 'submit');

    let renderedSections: Prisma.JsonValue = [];
    if (input.configurationToken) {
      const renderSession = await this.prisma.cfIntakeRenderSession.findFirst({
        where: { organizationId: assignment.organizationId, configurationToken: input.configurationToken },
      });
      if (!renderSession || renderSession.formAssignmentId !== assignment.id || renderSession.expiresAt <= new Date()) {
        throw new ConflictException('This form has changed. Reload the form to use the latest version.');
      }
      renderedSections = renderSession.renderedSections;
    }

    // Only the organization's active programs can be chosen; anything else is refused up front
    // instead of failing halfway through.
    const programs = selectedProgramIds.length
      ? await this.prisma.cfProgram.findMany({
          where: { organizationId: assignment.organizationId, id: { in: selectedProgramIds }, isActive: true },
          select: { id: true, name: true },
        })
      : [];
    if (programs.length !== selectedProgramIds.length) {
      throw new BadRequestException('One or more selected programs are not available.');
    }
    const programById = new Map(programs.map((program) => [program.id, program]));
    const actor = input.actorDisplayName ?? 'Client submission';
    const submittedAt = new Date();

    const { submission, enrollmentIds, enrollmentIdsByProgramId, createdProgramIds } = await this.prisma.$transaction(async (transaction) => {
      // Claim the form: only one request can move it to submitted.
      const claimed = await transaction.cfFormAssignment.updateMany({
        where: { id: assignment.id, organizationId: assignment.organizationId, submittedAt: null, cancelledAt: null },
        data: { status: FORM_STATUS.submitted, submittedAt, responses: coreResponses as Prisma.InputJsonObject },
      });
      if (claimed.count !== 1) throw new ConflictException(PUBLIC_FORM_ALREADY_SUBMITTED);

      const ids: string[] = [];
      const idsByProgram: Record<string, string> = {};
      const createdProgramIds: string[] = [];
      for (const programId of selectedProgramIds) {
        const { enrollmentId, created } = await this.enrollments.ensureEnrollmentWithin(transaction, {
          organizationId: assignment.organizationId,
          clientId: client.id,
          programId,
          programName: programById.get(programId)?.name ?? 'the selected program',
          assignedUserId: client.assignedUserId,
          assignedStaff: client.assignedStaff,
          actorDisplayName: actor,
          isDemo: client.isDemo,
          statusHistoryReason: 'Selected on the intake form.',
        });
        ids.push(enrollmentId);
        idsByProgram[programId] = enrollmentId;
        if (created) createdProgramIds.push(programId);
      }

      const created = await transaction.cfIntakeSubmission.create({
        data: {
          organizationId: assignment.organizationId,
          clientId: client.id,
          formAssignmentId: assignment.id,
          idempotencyKey,
          requestHash,
          configurationToken: input.configurationToken ?? '',
          responsePayload: coreResponses as Prisma.InputJsonObject,
          resultPayload: { success: true, enrollmentIds: ids },
          source: assignment.deliveryMethod ?? 'secure_link',
          submitterEmail: assignment.recipientEmail,
          submittedAt,
          isDemo: client.isDemo,
        },
      });
      if (selectedProgramIds.length) {
        await transaction.cfIntakeSubmissionSnapshot.create({
          data: {
            organizationId: assignment.organizationId,
            intakeSubmissionId: created.id,
            coreTemplateId: assignment.formId,
            coreTemplateVersion: 1,
            selectedProgramIds,
            renderedSections: renderedSections ?? [],
          },
        });
        await transaction.cfIntakeSubmissionProgram.createMany({
          data: selectedProgramIds.map((programId) => ({
            organizationId: assignment.organizationId,
            intakeSubmissionId: created.id,
            programId,
            enrollmentId: idsByProgram[programId],
            responsePayload: (programResponses[programId] ?? {}) as Prisma.InputJsonObject,
          })),
        });
      }

      const primaryProgram = selectedProgramIds.length ? programById.get(selectedProgramIds[0]) : undefined;
      await transaction.cfClient.update({
        where: { id: client.id },
        data: {
          status: primaryProgram ? CLIENT_STATUS.programSelected : CLIENT_STATUS.intakeSubmitted,
          // Legacy mirror for older screens; workflow decisions read the enrollments.
          ...(primaryProgram ? { programId: primaryProgram.id } : {}),
          ...(primaryProgram
            ? { intake: { ...(isRecord(client.intake) ? client.intake : {}), programOfInterest: primaryProgram.name } }
            : {}),
        },
      });
      await transaction.cfActivityLog.create({
        data: {
          organizationId: assignment.organizationId,
          clientId: client.id,
          action: 'INTAKE_SUBMITTED',
          description: selectedProgramIds.length
            ? `Intake submitted for ${programs.map((program) => program.name).join(', ')}.`
            : 'Intake submitted without a program selection.',
          user: actor,
          isDemo: client.isDemo,
        },
      });
      return { submission: created, enrollmentIds: ids, enrollmentIdsByProgramId: idsByProgram, createdProgramIds };
    });

    // After commit: nothing below can undo or duplicate the submission.
    await this.notifyAdmins({
      organizationId: assignment.organizationId,
      clientId: client.id,
      submissionId: submission.id,
      message: programs.length
        ? `${client.primaryContactName} submitted intake and selected ${programs.map((program) => program.name).join(', ')}.`
        : `${client.primaryContactName} submitted intake without choosing a program.`,
      isDemo: client.isDemo,
    });

    const automation = selectedProgramIds.length
      ? await this.fireTrigger({
          organizationId: assignment.organizationId,
          clientId: client.id,
          trigger: 'intake.submitted',
          programIds: selectedProgramIds,
          enrollmentIdsByProgramId,
          actorDisplayName: actor,
          idempotencySeed: `intake.submitted:${submission.id}`,
          payload: { selectedProgramIds },
        })
      : null;
    // Enrollments this submission created start their program's "enrollment created" rules.
    if (createdProgramIds.length) {
      await this.fireTrigger({
        organizationId: assignment.organizationId,
        clientId: client.id,
        trigger: 'enrollment.created',
        programIds: createdProgramIds,
        enrollmentIdsByProgramId,
        actorDisplayName: actor,
        idempotencySeed: `enrollment.created:${submission.id}`,
      });
    }
    // A program's own form (tied to an enrollment) completes: that program's "form completed" rules.
    if (assignment.enrollmentId) {
      const enrollment = await this.prisma.cfProgramEnrollment.findFirst({
        where: { id: assignment.enrollmentId, organizationId: assignment.organizationId },
        select: { id: true, programId: true },
      });
      if (enrollment) {
        await this.fireTrigger({
          organizationId: assignment.organizationId,
          clientId: client.id,
          trigger: 'form.completed',
          programIds: [enrollment.programId],
          enrollmentIdsByProgramId: { [enrollment.programId]: enrollment.id },
          actorDisplayName: actor,
          idempotencySeed: `form.completed:${submission.id}`,
          payload: { formId: assignment.formId, assignmentId: assignment.id },
        });
      }
    }

    return {
      success: true,
      submissionId: submission.id,
      clientId: client.id,
      assignmentId: assignment.id,
      enrollmentIds,
      automation,
    };
  }

  /** Automation runs after the submission is recorded; a failure there never affects it. */
  private async fireTrigger(request: Parameters<ProgramAutomationService['runTrigger']>[0]): Promise<unknown> {
    if (!this.automation) return null;
    try {
      return await this.automation.runTrigger(request);
    } catch (error) {
      this.logger.warn(`Automation ${request.trigger} failed for client ${request.clientId}: ${(error as Error).message}`);
      return null;
    }
  }

  private replay(
    recorded: { id: string; clientId: string; resultPayload: Prisma.JsonValue },
    assignmentId: string,
  ): IntakeSubmissionResult {
    const result = isRecord(recorded.resultPayload) ? recorded.resultPayload : {};
    const enrollmentIds = Array.isArray(result.enrollmentIds)
      ? result.enrollmentIds.filter((id): id is string => typeof id === 'string')
      : [];
    return {
      success: true,
      submissionId: recorded.id,
      clientId: recorded.clientId,
      assignmentId,
      enrollmentIds,
      automation: null,
      replayed: true,
    };
  }

  /** One notification per organization admin; a failure here never affects the submission. */
  private async notifyAdmins(payload: {
    organizationId: string;
    clientId: string;
    submissionId: string;
    message: string;
    isDemo: boolean;
  }) {
    try {
      const admins = await this.prisma.adminUser.findMany({
        where: { organizationId: payload.organizationId, isActive: true, role: { in: ['org_admin', 'super_admin'] } },
        select: { id: true },
      });
      if (!admins.length) return;
      await this.prisma.cfNotification.createMany({
        data: admins.map((admin) => ({
          organizationId: payload.organizationId,
          recipientAdminId: admin.id,
          type: 'INTAKE_SUBMITTED',
          title: 'Intake submitted',
          message: payload.message,
          actionUrl: `/clients/${payload.clientId}?tab=forms`,
          sourceType: 'intake_submission',
          sourceId: payload.submissionId,
          clientId: payload.clientId,
          submissionId: payload.submissionId,
          isDemo: payload.isDemo,
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.warn(`Unable to notify admins about submission ${payload.submissionId}: ${(error as Error).message}`);
    }
  }
}
