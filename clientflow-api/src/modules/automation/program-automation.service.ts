import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CfEnrollmentStatus, CfProgramAction, CfProgramTrigger, Prisma } from '../../generated/clientflow';
import { N8nService } from '../../integrations/n8n/n8n.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isPrismaUniqueViolation } from '../../common/prisma-errors';
import { CONTRACT_CLIENT_STATUS, CONTRACT_STATUS } from '../contracts/contract-lifecycle';
import { ContractsService } from '../contracts/contracts.service';
import { WorkflowConfigService } from '../programs/workflow-config.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';

type AutomationTrigger =
  | 'intake.submitted'
  | 'enrollment.created'
  | 'enrollment.approved'
  | 'contract.signed'
  | 'form.completed'
  | 'document.uploaded'
  | 'program.completed';

interface TriggerRequest {
  organizationId: string;
  clientId: string;
  trigger: AutomationTrigger;
  programIds: string[];
  enrollmentIdsByProgramId?: Record<string, string>;
  actorUserId?: string | null;
  actorDisplayName?: string;
  idempotencySeed?: string;
  payload?: Record<string, unknown>;
}

interface ProgramExecutionContext {
  organizationId: string;
  trigger: AutomationTrigger;
  triggerDb: CfProgramTrigger;
  client: {
    id: string;
    email: string;
    primaryContactName: string;
    assignedUserId: string | null;
    assignedStaff: string;
    isDemo: boolean;
  };
  program: {
    id: string;
    name: string;
    defaultFormTemplateId: string;
  };
  enrollmentId: string | null;
  actorUserId: string | null;
  actorDisplayName: string;
  payload: Record<string, unknown>;
  idempotencySeed: string;
}

const TRIGGER_MAP: Record<AutomationTrigger, CfProgramTrigger> = {
  'intake.submitted': CfProgramTrigger.intake_submitted,
  'enrollment.created': CfProgramTrigger.enrollment_created,
  'enrollment.approved': CfProgramTrigger.enrollment_approved,
  'contract.signed': CfProgramTrigger.contract_signed,
  'form.completed': CfProgramTrigger.form_completed,
  'document.uploaded': CfProgramTrigger.document_uploaded,
  'program.completed': CfProgramTrigger.program_completed,
};

@Injectable()
export class ProgramAutomationService {
  private readonly logger = new Logger(ProgramAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ContractsService))
    private readonly contracts: ContractsService,
    private readonly n8n: N8nService,
    private readonly workflowConfig: WorkflowConfigService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  async runTrigger(request: TriggerRequest) {
    const triggerDb = TRIGGER_MAP[request.trigger];
    const uniqueProgramIds = [...new Set(request.programIds.filter((programId) => typeof programId === 'string' && programId))];
    if (!triggerDb || uniqueProgramIds.length === 0) return { trigger: request.trigger, programs: [] };

    const client = await this.prisma.cfClient.findFirst({
      where: { id: request.clientId, organizationId: request.organizationId, isArchived: false },
      select: {
        id: true,
        email: true,
        primaryContactName: true,
        assignedUserId: true,
        assignedStaff: true,
        isDemo: true,
      },
    });
    if (!client) return { trigger: request.trigger, programs: [] };

    const programs = await this.prisma.cfProgram.findMany({
      where: {
        organizationId: request.organizationId,
        id: { in: uniqueProgramIds },
        isActive: true,
      },
      select: { id: true, name: true, defaultFormTemplateId: true },
      orderBy: { name: 'asc' },
    });

    const results: Array<{ programId: string; actions: string[] }> = [];
    for (const program of programs) {
      const context: ProgramExecutionContext = {
        organizationId: request.organizationId,
        trigger: request.trigger,
        triggerDb,
        client,
        program,
        enrollmentId: request.enrollmentIdsByProgramId?.[program.id] ?? null,
        actorUserId: request.actorUserId ?? null,
        actorDisplayName: request.actorDisplayName ?? 'system',
        payload: request.payload ?? {},
        idempotencySeed: request.idempotencySeed ?? `${request.trigger}:${request.clientId}`,
      };
      const actions = await this.executeProgramRules(context);
      results.push({ programId: program.id, actions });
    }

    return { trigger: request.trigger, programs: results };
  }

  private async executeProgramRules(context: ProgramExecutionContext): Promise<string[]> {
    const rules = await this.prisma.cfProgramAutomationRule.findMany({
      where: {
        organizationId: context.organizationId,
        programId: context.program.id,
        trigger: context.triggerDb,
        enabled: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const executed: string[] = [];
    if (rules.length === 0 && context.triggerDb === CfProgramTrigger.intake_submitted) {
      const workflow = await this.workflowConfig.getOrCreate(context.organizationId, context.program.id, context.program.name);
      const shouldSendContract = workflow.enabled && workflow.sendContractAfterIntake;
      if (shouldSendContract) {
        const idempotencyKey = `${context.idempotencySeed}:${context.program.id}:workflow:auto_send_contract`;
        const claim = await this.claimExecution(
          context,
          'workflow:auto_send_contract',
          CfProgramAction.send_contract,
          idempotencyKey,
        );
        if (!claim) return ['send_contract:skipped_duplicate'];
        try {
          const result = await this.sendContract(context, {});
          await this.prisma.cfProgramAutomationExecution.update({
            where: { id: claim.id },
            data: {
              status: 'completed',
              details: result,
            },
          });
          return ['send_contract'];
        } catch (error) {
          await this.prisma.cfProgramAutomationExecution.update({
            where: { id: claim.id },
            data: {
              status: 'failed',
              details: {
                error: (error as Error).message,
              },
            },
          });
          this.logger.warn(`Workflow auto contract failed for program ${context.program.id}: ${(error as Error).message}`);
          return ['send_contract:failed'];
        }
      }
    }

    for (const rule of rules) {
      if (!this.conditionsMatch(rule.conditions, context)) continue;
      const idempotencyKey = `${context.idempotencySeed}:${context.program.id}:${rule.id}`;
      const claim = await this.claimExecution(context, rule.id, rule.action, idempotencyKey);
      if (!claim) {
        executed.push(`${rule.action}:skipped_duplicate`);
        continue;
      }

      const actionConfig = this.jsonObject(rule.actionConfig);
      try {
        const result = await this.executeAction(rule.action, actionConfig, context, rule.id);
        await this.prisma.cfProgramAutomationExecution.update({
          where: { id: claim.id },
          data: {
            status: 'completed',
            details: result,
          },
        });
        executed.push(String(rule.action));
      } catch (error) {
        await this.prisma.cfProgramAutomationExecution.update({
          where: { id: claim.id },
          data: {
            status: 'failed',
            details: {
              error: (error as Error).message,
            },
          },
        });
        this.logger.warn(`Automation action ${rule.action} failed for program ${context.program.id}: ${(error as Error).message}`);
        executed.push(`${rule.action}:failed`);
      }
    }

    return executed;
  }

  private async executeAction(
    action: CfProgramAction,
    actionConfig: Record<string, unknown>,
    context: ProgramExecutionContext,
    ruleId: string,
  ): Promise<Prisma.JsonObject> {
    switch (action) {
      case CfProgramAction.create_enrollment:
        return this.ensureEnrollment(context);
      case CfProgramAction.assign_document:
        return this.assignDocuments(context, actionConfig);
      case CfProgramAction.send_form:
        return this.sendForm(context, actionConfig);
      case CfProgramAction.send_contract:
        return this.sendContract(context, actionConfig);
      case CfProgramAction.send_email:
        return this.sendEmail(context, actionConfig, ruleId);
      case CfProgramAction.create_task:
        return this.createTask(context, actionConfig);
      case CfProgramAction.change_status:
        return this.changeStatus(context, actionConfig);
      case CfProgramAction.notify_staff:
        return this.notifyStaff(context, actionConfig);
      default:
        return { skipped: true };
    }
  }

  private async ensureEnrollment(context: ProgramExecutionContext): Promise<Prisma.JsonObject> {
    const result = await this.enrollments.ensureEnrollment({
      organizationId: context.organizationId,
      clientId: context.client.id,
      programId: context.program.id,
      programName: context.program.name,
      assignedUserId: context.client.assignedUserId,
      assignedStaff: context.client.assignedStaff,
      actorUserId: context.actorUserId,
      actorDisplayName: context.actorDisplayName,
      isDemo: context.client.isDemo,
    });
    context.enrollmentId = result.enrollmentId;
    return { enrollmentId: result.enrollmentId, created: result.created };
  }

  private async assignDocuments(
    context: ProgramExecutionContext,
    actionConfig: Record<string, unknown>,
  ): Promise<Prisma.JsonObject> {
    const templateFilter = typeof actionConfig.templateId === 'string' ? actionConfig.templateId : null;
    const templates = await this.prisma.cfProgramDocumentTemplate.findMany({
      where: {
        organizationId: context.organizationId,
        programId: context.program.id,
        isActive: true,
        OR: [{ trigger: null }, { trigger: context.triggerDb }],
        ...(templateFilter ? { id: templateFilter } : {}),
      },
      orderBy: [{ required: 'desc' }, { createdAt: 'asc' }],
    });

    const assigned: string[] = [];
    const assignmentScope = context.enrollmentId ? `enrollment:${context.enrollmentId}` : 'client';
    for (const template of templates) {
      if (!template.activeVersionId) continue;
      const version = await this.prisma.cfProgramDocumentVersion.findFirst({
        where: {
          organizationId: context.organizationId,
          templateId: template.id,
          id: template.activeVersionId,
        },
      });
      if (!version) continue;

      const existing = await this.prisma.cfDocumentAssignment.findFirst({
        where: {
          organizationId: context.organizationId,
          clientId: context.client.id,
          programId: context.program.id,
          templateVersionId: version.id,
          assignmentScope,
        },
      });
      if (existing) continue;

      try {
        const assignment = await this.prisma.cfDocumentAssignment.create({
          data: {
            organizationId: context.organizationId,
            clientId: context.client.id,
            enrollmentId: context.enrollmentId,
            programId: context.program.id,
            templateId: template.id,
            templateVersionId: version.id,
            assignmentScope,
            status: template.autoSend ? 'sent' : 'assigned',
            sentAt: template.autoSend ? new Date() : null,
            required: template.required,
            signatureRequired: template.signatureRequired,
            createdByUserId: context.actorUserId,
            isDemo: context.client.isDemo,
          },
        });
        assigned.push(assignment.id);
      } catch (error) {
        if (!isPrismaUniqueViolation(error)) throw error;
      }
    }

    return { assignedIds: assigned };
  }

  private async sendForm(
    context: ProgramExecutionContext,
    actionConfig: Record<string, unknown>,
  ): Promise<Prisma.JsonObject> {
    const explicitFormId = typeof actionConfig.formTemplateId === 'string'
      ? actionConfig.formTemplateId
      : null;
    const formId = explicitFormId || context.program.defaultFormTemplateId;
    const template = await this.prisma.cfFormTemplate.findFirst({
      where: {
        id: formId,
        organizationId: context.organizationId,
        isActive: true,
      },
    });
    if (!template) return { skipped: true, reason: 'form_template_missing' };

    const existing = await this.prisma.cfFormAssignment.findFirst({
      where: {
        organizationId: context.organizationId,
        clientId: context.client.id,
        formId: template.id,
        enrollmentId: context.enrollmentId,
        cancelledAt: null,
        submittedAt: null,
      },
    });
    if (existing) return { assignmentId: existing.id, created: false };

    const dueInDays = typeof template.dueInDays === 'number' && Number.isFinite(template.dueInDays)
      ? template.dueInDays
      : 7;
    const dueAt = new Date(Date.now() + dueInDays * 86_400_000);
    const assignment = await this.prisma.cfFormAssignment.create({
      data: {
        organizationId: context.organizationId,
        clientId: context.client.id,
        enrollmentId: context.enrollmentId,
        formId: template.id,
        assignedUserId: context.client.assignedUserId,
        deliveryMethod: 'automation',
        recipientEmail: context.client.email,
        status: 'sent',
        dueAt,
        dueDate: dueAt.toISOString().slice(0, 10),
        sentAt: new Date(),
        expiresAt: dueAt,
        secureLinkToken: randomTokenHash(),
        createdByUserId: context.actorUserId,
        isDemo: context.client.isDemo,
      },
    });

    return { assignmentId: assignment.id, created: true };
  }

  private async sendContract(
    context: ProgramExecutionContext,
    actionConfig: Record<string, unknown>,
  ): Promise<Prisma.JsonObject> {
    const requiresStaffApproval = actionConfig.requireStaffApproval === true;
    if (requiresStaffApproval) {
      await this.prisma.cfClient.update({
        where: { id: context.client.id },
        data: { status: CONTRACT_CLIENT_STATUS.pendingStaffReview },
      });
      await this.prisma.cfActivityLog.create({
        data: {
          organizationId: context.organizationId,
          clientId: context.client.id,
          enrollmentId: context.enrollmentId,
          actorUserId: context.actorUserId,
          action: 'PENDING_STAFF_REVIEW',
          description: 'Program automation held contract for staff approval.',
          user: 'automation',
          isDemo: context.client.isDemo,
        },
      });
      return { queuedForStaffReview: true };
    }

    const latestContract = await this.prisma.cfContract.findFirst({
      where: {
        organizationId: context.organizationId,
        clientId: context.client.id,
        programId: context.program.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (latestContract && [CONTRACT_STATUS.sent, CONTRACT_STATUS.opened, CONTRACT_STATUS.completed].includes(latestContract.status as 'SENT' | 'OPENED' | 'COMPLETED')) {
      return { contractId: latestContract.id, skipped: true, reason: 'already_issued' };
    }

    let issued;
    try {
      issued = await this.contracts.issueContractForProgram(context.client.id, context.program.id, {
        enrollmentId: context.enrollmentId,
        staffSigner: {
          id: context.client.assignedUserId,
          name: context.client.assignedStaff && context.client.assignedStaff !== 'Unassigned'
            ? context.client.assignedStaff
            : 'EA Management Team',
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'The selected program does not have an active contract template.') {
        await this.prisma.cfClient.update({
          where: { id: context.client.id },
          data: { status: CONTRACT_CLIENT_STATUS.pendingStaffReview },
        });
        await this.prisma.cfActivityLog.create({
          data: {
            organizationId: context.organizationId,
            clientId: context.client.id,
            enrollmentId: context.enrollmentId,
            actorUserId: context.actorUserId,
            action: 'CONTRACT_CONFIGURATION_MISSING',
            description: `Automatic contract sending stopped because ${context.program.name} has no active contract version.`,
            user: 'automation',
            isDemo: context.client.isDemo,
          },
        });
        await this.createAdminNotifications(context, {
          sourceType: 'contract_configuration',
          sourceId: `${context.client.id}:${context.program.id}`,
          type: 'CONTRACT_CONFIGURATION_MISSING',
          title: 'Contract configuration missing',
          message: `${context.program.name} has auto-contract enabled but no active contract version.`,
          actionUrl: `/programs/${context.program.id}`,
        });
        return { queuedForStaffReview: true, reason: 'contract_configuration_missing' };
      }
      throw error;
    }

    return {
      contractId: issued.contract.id,
      status: issued.contract.status,
      emailStatus: issued.emailDelivery.status,
    };
  }

  private async sendEmail(
    context: ProgramExecutionContext,
    actionConfig: Record<string, unknown>,
    ruleId: string,
  ): Promise<Prisma.JsonObject> {
    const subject = typeof actionConfig.subject === 'string' && actionConfig.subject.trim()
      ? actionConfig.subject.trim()
      : `${context.program.name} update`;
    const message = typeof actionConfig.message === 'string' && actionConfig.message.trim()
      ? actionConfig.message.trim()
      : 'A program update is available in ClientFlow.';

    const availability = this.n8n.getWelcomeAvailability();
    const eventId = `automation.email:${context.idempotencySeed}:${ruleId}:${context.program.id}:${context.client.id}`;
    const communication = await this.prisma.cfCommunication.create({
      data: {
        organizationId: context.organizationId,
        clientId: context.client.id,
        enrollmentId: context.enrollmentId,
        eventId,
        recipientEmail: context.client.email,
        channel: 'email',
        provider: 'n8n',
        status: availability === 'ready' ? 'REQUESTED' : 'FAILED',
        requestedAt: new Date(),
        errorCode: availability === 'ready' ? null : availability,
        type: 'program_email',
        direction: 'outbound',
        subject,
        notes: message,
        date: new Date(),
        staffMember: 'automation',
        isDemo: context.client.isDemo,
      },
    });

    if (availability === 'ready') {
      await this.prisma.cfCommunication.update({
        where: { id: communication.id },
        data: { status: 'SENDING' },
      });
      const delivery = await this.n8n.sendWelcome(eventId, {
        organizationId: context.organizationId,
        clientId: context.client.id,
        recipientEmail: context.client.email,
        clientName: context.client.primaryContactName,
        programName: context.program.name,
        nextStep: message,
        sentByUserId: context.client.assignedUserId ?? 'system',
      });
      if (delivery.status === 'sent') {
        await this.prisma.cfCommunication.update({
          where: { id: communication.id },
          data: { status: 'SENT', sentAt: new Date(delivery.sentAt), failedAt: null, errorCode: null },
        });
      } else if (delivery.status === 'failed') {
        await this.prisma.cfCommunication.update({
          where: { id: communication.id },
          data: { status: 'FAILED', failedAt: new Date(), errorCode: delivery.reason },
        });
      }
      return { communicationId: communication.id, deliveryStatus: delivery.status };
    }

    return { communicationId: communication.id, deliveryStatus: 'skipped' };
  }

  private async createTask(
    context: ProgramExecutionContext,
    actionConfig: Record<string, unknown>,
  ): Promise<Prisma.JsonObject> {
    if (!context.enrollmentId) return { skipped: true, reason: 'enrollment_required' };
    const title = typeof actionConfig.title === 'string' && actionConfig.title.trim()
      ? actionConfig.title.trim()
      : `Follow up on ${context.program.name}`;
    const description = typeof actionConfig.description === 'string' && actionConfig.description.trim()
      ? actionConfig.description.trim()
      : null;

    const task = await this.prisma.cfTask.create({
      data: {
        organizationId: context.organizationId,
        enrollmentId: context.enrollmentId,
        clientId: context.client.id,
        title,
        description,
        assignedUserId: context.client.assignedUserId,
        assignedStaff: context.client.assignedStaff,
        isDemo: context.client.isDemo,
      },
    });

    return { taskId: task.id };
  }

  private async changeStatus(
    context: ProgramExecutionContext,
    actionConfig: Record<string, unknown>,
  ): Promise<Prisma.JsonObject> {
    if (!context.enrollmentId) return { skipped: true, reason: 'enrollment_required' };
    const nextStatus = typeof actionConfig.status === 'string' ? actionConfig.status : null;
    if (!nextStatus) return { skipped: true, reason: 'status_missing' };

    const current = await this.prisma.cfProgramEnrollment.findFirst({
      where: {
        id: context.enrollmentId,
        organizationId: context.organizationId,
      },
      select: { status: true },
    });
    if (!current) return { skipped: true, reason: 'enrollment_missing' };

    const updateResult = await this.prisma.cfProgramEnrollment.updateMany({
      where: { id: context.enrollmentId, organizationId: context.organizationId },
      data: {
        status: nextStatus as CfEnrollmentStatus,
        lastModifiedByUserId: context.actorUserId,
        lastModifiedByDisplayName: context.actorDisplayName,
      },
    });
    if (updateResult.count !== 1) return { skipped: true, reason: 'enrollment_not_updated' };
    await this.prisma.cfEnrollmentStatusHistory.create({
      data: {
        organizationId: context.organizationId,
        enrollmentId: context.enrollmentId,
        previousStatus: current.status,
        newStatus: nextStatus as CfEnrollmentStatus,
        changedByUserId: context.actorUserId,
        changedByDisplayName: context.actorDisplayName,
        reason: 'Updated by program automation.',
      },
    });

    return { enrollmentId: context.enrollmentId, status: nextStatus };
  }

  private async notifyStaff(
    context: ProgramExecutionContext,
    actionConfig: Record<string, unknown>,
  ): Promise<Prisma.JsonObject> {
    const message = typeof actionConfig.message === 'string' && actionConfig.message.trim()
      ? actionConfig.message.trim()
      : `${context.program.name} requires staff attention.`;

    await this.prisma.cfActivityLog.create({
      data: {
        organizationId: context.organizationId,
        clientId: context.client.id,
        enrollmentId: context.enrollmentId,
        actorUserId: context.actorUserId,
        action: 'STAFF_NOTIFIED',
        description: message,
        user: 'automation',
        isDemo: context.client.isDemo,
      },
    });

    return { notified: true };
  }

  private conditionsMatch(raw: Prisma.JsonValue, context: ProgramExecutionContext): boolean {
    const conditions = this.jsonObject(raw);
    if (!Object.keys(conditions).length) return true;

    const equals = this.jsonObject(conditions.equals as Prisma.JsonValue);
    for (const [field, expected] of Object.entries(equals)) {
      if (this.contextValue(field, context) !== expected) return false;
    }

    const includes = this.jsonObject(conditions.includes as Prisma.JsonValue);
    for (const [field, expected] of Object.entries(includes)) {
      const actual = this.contextValue(field, context);
      if (!Array.isArray(expected) || !expected.includes(actual)) return false;
    }

    return true;
  }

  private contextValue(field: string, context: ProgramExecutionContext): unknown {
    if (field === 'programId') return context.program.id;
    if (field === 'programName') return context.program.name;
    if (field === 'trigger') return context.trigger;
    if (field === 'clientStatus') return context.payload.clientStatus;
    if (field === 'enrollmentStatus') return context.payload.enrollmentStatus;
    return context.payload[field];
  }

  private jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
    return isRecord(value)
      ? value
      : {};
  }

  private async createAdminNotifications(
    context: ProgramExecutionContext,
    payload: {
      sourceType: string;
      sourceId: string;
      type: string;
      title: string;
      message: string;
      actionUrl?: string;
    },
  ) {
    const admins = await this.prisma.adminUser.findMany({
      where: {
        organizationId: context.organizationId,
        isActive: true,
        role: { in: ['org_admin', 'super_admin'] },
      },
      select: { id: true },
    });
    if (admins.length === 0) return;
    await this.prisma.cfNotification.createMany({
      data: admins.map((admin) => ({
        organizationId: context.organizationId,
        recipientAdminId: admin.id,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        actionUrl: payload.actionUrl ?? null,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        clientId: context.client.id,
        submissionId: null,
        isDemo: context.client.isDemo,
      })),
      skipDuplicates: true,
    });
  }

  private async claimExecution(
    context: ProgramExecutionContext,
    ruleId: string,
    action: CfProgramAction,
    idempotencyKey: string,
  ) {
    try {
      return await this.prisma.cfProgramAutomationExecution.create({
        data: {
          organizationId: context.organizationId,
          programId: context.program.id,
          clientId: context.client.id,
          enrollmentId: context.enrollmentId,
          trigger: context.triggerDb,
          action,
          ruleId,
          status: 'processing',
          idempotencyKey,
          details: {},
        },
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }
}

function randomTokenHash(): string {
  return randomBytes(32).toString('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
