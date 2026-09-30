import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import { N8nService } from '../../integrations/n8n/n8n.service';
import type { IntakeEmailDeliveryResult } from '../../integrations/n8n/n8n.types';
import { PrismaService } from '../../prisma/prisma.service';
import { findClientForOrg } from '../../common/tenancy/org-scoped.repository';
import { applyEnrollmentClosure } from '../lifecycle/enrollment-closure';
import { transitionEnrollment } from '../lifecycle/enrollment-state';

/** Intake assignments a staff resend brings back to life (never cancelled or submitted ones). */
const REOPENABLE_INTAKE_STATUSES: readonly string[] = ['draft', 'sending', 'expired', 'delivery_failed'];

/** Enrollments a program correction may withdraw: nothing has been signed or started yet. */
const CORRECTABLE_ENROLLMENT_STATUSES: readonly string[] = ['interested', 'pending_review', 'approved', 'onboarding'];
import {
  attemptEventId,
  COMMUNICATION_STATUS,
  DELIVERY_SOURCE,
  findAttemptByKey,
  isUniqueViolation,
  recordedDelivery,
} from '../communications/communication-attempts';
import { ContractsService } from '../contracts/contracts.service';
import {
  CLIENT_STATUS,
  FORM_STATUS,
  GENERAL_INTAKE_FIELDS,
  generalIntakeTemplateId,
  generatePublicToken,
  hashPublicToken,
} from '../forms/intake-lifecycle';
import { CreateClientDto } from './dto/create-client.dto';
import { NOT_UNSIGNED_LEGACY_CONTRACT } from '../contracts/legacy-contract';
import { assertSendableRecipient } from '../communications/recipient';

type DeferredEmailDelivery = { status: 'deferred' };

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    private readonly n8n: N8nService,
    private readonly contracts: ContractsService,
  ) {}

  async create(organizationId: string, dto: CreateClientDto) {
    // Temporary intake diagnosis: never log the DTO, SQL, error message, or public token.
    const traceId = randomUUID();
    let eventId: string | null = null;
    const traceStep = async <T>(stage: string, action: () => Promise<T>): Promise<T> => {
      this.logger.log(JSON.stringify({ eventType: 'intake.send', eventId, traceId, stage, state: 'started' }));
      try {
        const result = await action();
        this.logger.log(JSON.stringify({ eventType: 'intake.send', eventId, traceId, stage, state: 'completed' }));
        return result;
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        this.logger.error(JSON.stringify({
          eventType: 'intake.send', eventId, traceId, stage, state: 'failed',
          errorCode: typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null,
        }));
        throw error;
      }
    };
    this.logger.log(JSON.stringify({
      eventType: 'intake.send', eventId, traceId, stage: 'ClientsService.create',
      sendIntakeImmediately: dto.sendIntakeImmediately !== false,
    }));
    const organization = await traceStep('organization.lookup', () => this.prisma.organization.findFirst({
      where: { id: organizationId, status: 'active' },
      select: { id: true },
    }));
    if (!organization) throw new NotFoundException('Organization not found.');

    const assignee = dto.assignedStaffId
      ? await traceStep('assignee.lookup', () => this.prisma.adminUser.findFirst({
          where: { id: dto.assignedStaffId, organizationId: organization.id, isActive: true },
          select: { id: true, email: true, firstName: true, lastName: true },
        }))
      : null;
    if (dto.assignedStaffId && !assignee) throw new NotFoundException('Assigned staff member not found.');

    const rawToken = generatePublicToken();
    const tokenHash = hashPublicToken(rawToken);
    const now = new Date();
    const appUrl = this.config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    // /s/:token (not /apply/:token) so the client sees program checkboxes and program-specific questions.
    const publicFormUrl = `${appUrl}/s/${rawToken}`;
    const assignedStaff = assignee
      ? [assignee.firstName, assignee.lastName].filter(Boolean).join(' ') || assignee.email
      : 'Unassigned';
    const n8nAvailability = this.n8n.getIntakeAvailability();
    const deferred = dto.sendIntakeImmediately === false;

    const created = await traceStep('intake.transaction', () => this.prisma.$transaction(async (transaction) => {
      let template = await traceStep('intake.template.lookup', () => transaction.cfFormTemplate.findFirst({
        where: { organizationId: organization.id, scope: 'master_core', isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }));
      if (!template) {
        template = await traceStep('intake.template.upsert', () => transaction.cfFormTemplate.upsert({
          where: { id: generalIntakeTemplateId(organization.id) },
          update: {},
          create: {
            id: generalIntakeTemplateId(organization.id),
            organizationId: organization.id,
            scope: 'master_core',
            name: 'General Intake Form',
            description: 'Tell us about you, your business, and the program you are interested in.',
            fields: GENERAL_INTAKE_FIELDS.map((field) => ({
              id: field.id,
              label: field.label,
              type: field.type,
              required: field.required,
              ...(field.options ? { options: [...field.options] } : {}),
            })),
            emailTemplate: 'general-intake',
            dueInDays: 7,
            isActive: true,
          },
        }));
      }

      const dueAt = new Date(now.getTime() + template.dueInDays * 86_400_000);
      const client = await traceStep('client.insert', () => transaction.cfClient.create({
        data: {
          organizationId: organization.id,
          primaryContactName: dto.contactName.trim(),
          businessName: dto.businessName?.trim() || dto.contactName.trim(),
          email: dto.email.trim().toLowerCase(),
          phone: dto.phone?.trim() || '',
          status: CLIENT_STATUS.intakeSent,
          lifecycleStatus: 'intake_pending',
          assignedStaff,
          assignedUserId: assignee?.id ?? null,
          intakeSource: dto.intakeSource?.trim() || 'admin_created',
          source: dto.intakeSource?.trim() || 'admin_created',
          intake: {},
        },
      }));
      const assignment = await traceStep('intake.assignment.insert', () => transaction.cfFormAssignment.create({
        data: {
          organizationId: organization.id,
          clientId: client.id,
          formId: template.id,
          assignedUserId: assignee?.id ?? null,
          deliveryMethod: 'email',
          recipientEmail: client.email,
          recipientPhone: client.phone || null,
          status: FORM_STATUS.sent,
          dueAt,
          dueDate: dueAt.toISOString().slice(0, 10),
          expiresAt: dueAt,
          sentAt: now,
          secureLinkToken: tokenHash,
          createdByUserId: assignee?.id ?? null,
        },
      }));
      eventId = `intake-${assignment.id}`;
      await traceStep('activity.CLIENT_CREATED.insert', () => transaction.cfActivityLog.create({
        data: {
          organizationId: organization.id,
          clientId: client.id,
          actorUserId: assignee?.id ?? null,
          action: 'CLIENT_CREATED',
          description: 'Client created and General Intake assigned.',
          user: assignedStaff,
        },
      }));
      if (deferred) {
        await traceStep('activity.INTAKE_EMAIL_DEFERRED.insert', () => transaction.cfActivityLog.create({
          data: {
            organizationId: organization.id,
            clientId: client.id,
            actorUserId: assignee?.id ?? null,
            action: 'INTAKE_EMAIL_DEFERRED',
            description: 'Intake email send deferred by staff at creation.',
            user: 'system',
          },
        }));
      } else if (n8nAvailability !== 'ready') {
        await traceStep('activity.INTAKE_EMAIL_SKIPPED.insert', () => transaction.cfActivityLog.create({
          data: {
            organizationId: organization.id,
            clientId: client.id,
            actorUserId: assignee?.id ?? null,
            action: 'INTAKE_EMAIL_SKIPPED',
            description: n8nAvailability === 'disabled'
              ? 'Intake email skipped because n8n delivery is disabled.'
              : 'Intake email skipped because n8n is not configured.',
            user: 'system',
          },
        }));
      }
      return { client, assignment, template, dueAt };
    }));

    this.logger.log(JSON.stringify({
      eventType: 'intake.send', eventId, traceId,
      stage: deferred ? 'intake.deferred' : 'intake.dispatch', availability: n8nAvailability,
    }));

    const emailDelivery: IntakeEmailDeliveryResult | DeferredEmailDelivery = deferred
      ? { status: 'deferred' }
      : await this.n8n.sendIntake(`intake-${created.assignment.id}`, {
          organizationId: organization.id,
          clientId: created.client.id,
          formId: created.assignment.formId,
          recipientEmail: created.client.email,
          clientName: created.client.primaryContactName,
          formName: 'General Intake Form',
          formUrl: publicFormUrl,
          dueDate: created.dueAt.toISOString(),
          expiresAt: created.assignment.expiresAt?.toISOString() ?? null,
          sentByUserId: assignee?.id ?? 'system',
        });

    if (emailDelivery.status === 'deferred') {
      // Deferred activity log was already recorded inside the creation transaction.
    } else if (emailDelivery.status !== 'skipped') {
      try {
        await this.prisma.cfActivityLog.create({
          data: {
            organizationId: organization.id,
            clientId: created.client.id,
            actorUserId: assignee?.id ?? null,
            action: emailDelivery.status === 'sent' ? 'INTAKE_EMAIL_SENT' : 'INTAKE_EMAIL_FAILED',
            description: emailDelivery.status === 'sent'
              ? 'General Intake email accepted by n8n.'
              : `General Intake email delivery failed: ${emailDelivery.reason}.`,
            user: 'system',
          },
        });
      } catch {
        this.logger.warn(`Unable to record intake email status for assignment ${created.assignment.id}.`);
      }
    }

    return {
      client: {
        id: created.client.id,
        organizationId: created.client.organizationId,
        contactName: created.client.primaryContactName,
        businessName: created.client.businessName,
        email: created.client.email,
        phone: created.client.phone,
        status: created.client.status,
      },
      assignment: {
        id: created.assignment.id,
        formTemplateId: created.template.id,
        formName: created.template.name,
        status: created.assignment.status,
        dueDate: created.assignment.dueDate,
        sentAt: created.assignment.sentAt,
        submittedAt: created.assignment.submittedAt,
      },
      publicFormUrl,
      emailDelivery,
    };
  }

  async list(organizationId: string, status?: string) {
    const clients = await this.prisma.cfClient.findMany({
      where: { organizationId, isArchived: false, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return clients.map((client) => this.safeClient(client));
  }

  async getOne(organizationId: string, id: string) {
    const client = await findClientForOrg(this.prisma, organizationId, id);

    const [program, contract, monitoringTask, executedDocument] = await Promise.all([
      this.currentProgram(client.organizationId, client.id),
      this.prisma.cfContract.findFirst({
        where: { clientId: client.id, organizationId: client.organizationId, ...NOT_UNSIGNED_LEGACY_CONTRACT },
        orderBy: { createdAt: 'desc' },
      }),
      this.latestMonitoring(client.organizationId, client.id),
      this.prisma.cfDocument.findFirst({
        where: { clientId: client.id, organizationId: client.organizationId, type: 'contract' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      ...this.safeClient(client),
      program: program ? { id: program.id, name: program.name } : null,
      contract: contract
        ? {
            id: contract.id,
            status: contract.status,
            contractType: contract.contractType,
            sentAt: contract.sentAt,
            completedAt: contract.completedAt,
            staffSignedByName: contract.staffSignedByName,
            staffSignedAt: contract.staffSignedAt,
            signedName: contract.signedName,
            signedEmail: contract.signedEmail,
            // The fully executed document (both signatures) — this client's permanent record.
            content: contract.completedAt ? contract.generatedContent : null,
            documentUrl: executedDocument?.url ?? null,
          }
        : null,
      monitoringTask: monitoringTask
        ? {
            id: monitoringTask.id,
            type: monitoringTask.type,
            status: monitoringTask.status,
            dueDate: monitoringTask.dueDate,
          }
        : null,
    };
  }

  /** The program of the client's most recent open enrollment (never the legacy client.programId). */
  private async currentProgram(organizationId: string, clientId: string) {
    const enrollment = await this.prisma.cfProgramEnrollment.findFirst({
      where: {
        organizationId,
        clientId,
        isArchived: false,
        status: { notIn: ['completed', 'declined', 'withdrawn'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { programId: true },
    });
    if (!enrollment) return null;
    return this.prisma.cfProgram.findFirst({ where: { id: enrollment.programId, organizationId } });
  }

  /**
   * The client's most recent monitoring item, from their enrollments (canonical). Clients whose only
   * follow-up predates enrollment monitoring still show that legacy task.
   */
  private async latestMonitoring(organizationId: string, clientId: string) {
    const enrollmentIds = (await this.prisma.cfProgramEnrollment.findMany({
      where: { organizationId, clientId },
      select: { id: true },
    })).map((enrollment) => enrollment.id);
    const item = enrollmentIds.length
      ? await this.prisma.cfEnrollmentMonitoring.findFirst({
          where: { organizationId, enrollmentId: { in: enrollmentIds }, active: true },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    if (item) {
      return { id: item.id, type: item.name, status: item.complianceStatus, dueDate: item.nextReviewAt };
    }
    return this.prisma.cfMonitoringTask.findFirst({
      where: { clientId, organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateProgram(
    organizationId: string,
    id: string,
    programId: string,
    actor: { id: string | null; name: string } | null = null,
  ) {
    const client = await findClientForOrg(this.prisma, organizationId, id);

    const program = await this.prisma.cfProgram.findFirst({
      where: { id: programId, organizationId: client.organizationId, isActive: true },
    });
    if (!program) throw new NotFoundException('Program not found.');

    // client.programId is only the legacy mirror of the selection being corrected. The enrollment
    // it pointed at is withdrawn if it never got past onboarding (its open contracts and forms are
    // cancelled with it); an enrollment that is already active is a real membership and stays.
    const previousProgramId = client.programId;
    const previous = previousProgramId && previousProgramId !== programId
      ? await this.prisma.cfProgramEnrollment.findFirst({
          where: { organizationId: client.organizationId, clientId: client.id, programId: previousProgramId },
        })
      : null;
    await this.prisma.$transaction(async (transaction) => {
      if (previous && CORRECTABLE_ENROLLMENT_STATUSES.includes(previous.status)) {
        const now = new Date();
        await transitionEnrollment(transaction, {
          organizationId: client.organizationId,
          enrollmentId: previous.id,
          from: previous.status,
          to: 'withdrawn',
          data: { withdrawnAt: now },
          history: {
            changedByUserId: actor?.id ?? null,
            changedByDisplayName: actor?.name ?? 'staff',
            reason: `Program corrected to ${program.name}.`,
          },
        });
        await applyEnrollmentClosure(transaction, { ...previous, status: 'withdrawn' }, now);
      }
      await transaction.cfClient.update({ where: { id: client.id }, data: { programId } });
      await transaction.cfActivityLog.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          actorUserId: client.assignedUserId,
          action: 'PROGRAM_CORRECTED',
          description: previousProgramId
            ? `Program corrected to ${program.name}.`
            : `Program set to ${program.name}.`,
          user: 'staff',
        },
      });
    });

    return this.contracts.handlePostIntakeProgramSelection(client.organizationId, client.id, program.id, actor);
  }

  /**
   * Sends (or resends) the General Intake email. Only the client's general-intake assignment is ever
   * resent (never a program form that happens to be the newest assignment), and every attempt leaves
   * a communication row and an activity row with the staff member and source.
   */
  async sendIntakeNow(
    organizationId: string,
    id: string,
    options: { actor?: { id: string | null; name: string } | null; idempotencyKey?: string | null } = {},
  ) {
    const client = await findClientForOrg(this.prisma, organizationId, id);

    // A retried request (same Idempotency-Key) returns the first attempt instead of emailing twice.
    if (options.idempotencyKey) {
      const prior = await findAttemptByKey(this.prisma, client.organizationId, options.idempotencyKey);
      if (prior) return { emailDelivery: recordedDelivery(prior), replayed: true as const };
    }
    assertSendableRecipient({ email: client.email, name: client.primaryContactName });

    const masterTemplates = await this.prisma.cfFormTemplate.findMany({
      where: { organizationId: client.organizationId, scope: 'master_core' },
      select: { id: true },
    });
    const intakeTemplateIds = [
      generalIntakeTemplateId(client.organizationId),
      ...masterTemplates.map((template) => template.id),
    ];
    const assignment = await this.prisma.cfFormAssignment.findFirst({
      where: {
        clientId: client.id,
        organizationId: client.organizationId,
        cancelledAt: null,
        formId: { in: intakeTemplateIds },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!assignment) throw new NotFoundException('No General Intake assignment found for this client.');
    if (assignment.submittedAt) {
      throw new ConflictException('This client has already submitted their intake.');
    }

    const manual = DELIVERY_SOURCE.manual;
    const staffName = options.actor?.name?.trim() || 'staff';
    const availability = this.n8n.getIntakeAvailability();
    const now = new Date();
    const communicationId = randomUUID();
    const eventId = attemptEventId('intake.send', assignment.id, communicationId);
    let communication: { id: string };
    try {
      communication = await this.prisma.cfCommunication.create({
        data: {
          id: communicationId,
          organizationId: client.organizationId,
          clientId: client.id,
          eventId,
          formAssignmentId: assignment.id,
          formId: assignment.formId,
          recipientEmail: client.email,
          channel: 'email',
          provider: 'n8n',
          status: availability === 'ready' ? COMMUNICATION_STATUS.requested : COMMUNICATION_STATUS.failed,
          requestedAt: now,
          errorCode: availability === 'ready' ? null : availability,
          type: 'intake_email',
          direction: 'outbound',
          subject: 'General Intake Form',
          notes: availability === 'ready' ? 'Intake email requested by staff.' : 'Intake email blocked before send.',
          date: now,
          staffMember: staffName,
          createdByUserId: options.actor?.id ?? null,
          source: manual,
          idempotencyKey: options.idempotencyKey ?? null,
          isDemo: client.isDemo,
        },
      });
    } catch (error) {
      if (options.idempotencyKey && isUniqueViolation(error)) {
        const prior = await findAttemptByKey(this.prisma, client.organizationId, options.idempotencyKey);
        if (prior) return { emailDelivery: recordedDelivery(prior), replayed: true as const };
      }
      throw error;
    }

    // secureLinkToken only ever stores a hash, so a fresh raw token must be rotated in to link the
    // client. Only rotate when the email can actually go out: rotating while delivery is down would
    // kill the link the client already has and send nothing. A resend also restarts the due date
    // and expiry, so the new link isn't born expired.
    const rawToken = generatePublicToken();
    let dueAt = assignment.dueAt;
    let expiresAt = assignment.expiresAt;
    if (availability === 'ready') {
      const template = await this.prisma.cfFormTemplate.findFirst({
        where: { id: assignment.formId, organizationId: client.organizationId },
        select: { dueInDays: true },
      });
      dueAt = new Date(now.getTime() + (template?.dueInDays ?? 7) * 86_400_000);
      expiresAt = dueAt;
      await this.prisma.cfFormAssignment.update({
        where: { id: assignment.id },
        data: {
          secureLinkToken: hashPublicToken(rawToken),
          secureLink: null,
          dueAt,
          dueDate: dueAt.toISOString().slice(0, 10),
          expiresAt,
          // An expired or undelivered intake is reopened by the resend; otherwise the new link
          // would be refused as closed the moment the client opened it.
          ...(REOPENABLE_INTAKE_STATUSES.includes(assignment.status) ? { status: 'sent' } : {}),
        },
      });
    }

    const appUrl = this.config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    const publicFormUrl = `${appUrl}/s/${rawToken}`;
    if (availability === 'ready') {
      await this.prisma.cfCommunication.update({
        where: { id: communication.id },
        data: { status: COMMUNICATION_STATUS.sending },
      });
    }
    const emailDelivery = await this.n8n.sendIntake(eventId, {
      organizationId: client.organizationId,
      clientId: client.id,
      formId: assignment.formId,
      recipientEmail: client.email,
      clientName: client.primaryContactName,
      formName: 'General Intake Form',
      formUrl: publicFormUrl,
      dueDate: (dueAt ?? now).toISOString(),
      expiresAt: expiresAt?.toISOString() ?? null,
      sentByUserId: options.actor?.id ?? client.assignedUserId ?? 'system',
    });
    const failureReason = emailDelivery.status === 'sent' ? null : emailDelivery.reason;
    await this.prisma.cfCommunication.update({
      where: { id: communication.id },
      data: emailDelivery.status === 'sent'
        ? { status: COMMUNICATION_STATUS.sent, sentAt: new Date(emailDelivery.sentAt), failedAt: null, errorCode: null }
        : { status: COMMUNICATION_STATUS.failed, failedAt: new Date(), errorCode: failureReason },
    });
    if (emailDelivery.status === 'sent') {
      await this.prisma.cfFormAssignment.updateMany({
        where: { id: assignment.id, organizationId: client.organizationId, submittedAt: null },
        data: { sentAt: new Date(emailDelivery.sentAt) },
      });
    }
    await this.prisma.cfActivityLog.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        actorUserId: options.actor?.id ?? client.assignedUserId,
        action: emailDelivery.status === 'sent' ? 'INTAKE_EMAIL_SENT' : 'INTAKE_EMAIL_FAILED',
        description: emailDelivery.status === 'sent'
          ? 'General Intake email sent by staff.'
          : `General Intake email delivery failed or skipped: ${emailDelivery.status}.`,
        user: staffName,
        source: manual,
      },
    });
    return { emailDelivery };
  }

  private safeClient(client: {
    id: string;
    organizationId: string;
    primaryContactName: string;
    businessName: string;
    email: string;
    phone: string;
    programId: string | null;
    status: string;
    assignedStaff: string;
    assignedUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: client.id,
      organizationId: client.organizationId,
      contactName: client.primaryContactName,
      businessName: client.businessName,
      email: client.email,
      phone: client.phone,
      programId: client.programId,
      status: client.status,
      assignedStaff: client.assignedStaff,
      assignedUserId: client.assignedUserId,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }
}
