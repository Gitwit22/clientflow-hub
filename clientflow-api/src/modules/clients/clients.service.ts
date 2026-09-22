import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import { N8nService } from '../../integrations/n8n/n8n.service';
import type { IntakeEmailDeliveryResult } from '../../integrations/n8n/n8n.types';
import { PrismaService } from '../../prisma/prisma.service';
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

  private assertClientAccessEnabled(): void {
    if (this.config.get('ALLOW_UNAUTHENTICATED_CLIENT_CREATION', { infer: true }) !== 'true') {
      throw new ForbiddenException('Client management is disabled until standalone authentication is available.');
    }
  }

  async create(dto: CreateClientDto) {
    if (this.config.get('ALLOW_UNAUTHENTICATED_CLIENT_CREATION', { infer: true }) !== 'true') {
      throw new ForbiddenException('Client creation is disabled until standalone authentication is available.');
    }

    const organization = await this.prisma.organization.findFirst({
      where: { id: dto.organizationId, status: 'active' },
      select: { id: true },
    });
    if (!organization) throw new NotFoundException('Organization not found.');

    const assignee = dto.assignedStaffId
      ? await this.prisma.adminUser.findFirst({
          where: { id: dto.assignedStaffId, organizationId: organization.id, isActive: true },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : null;
    if (dto.assignedStaffId && !assignee) throw new NotFoundException('Assigned staff member not found.');

    const rawToken = generatePublicToken();
    const tokenHash = hashPublicToken(rawToken);
    const now = new Date();
    const appUrl = this.config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    const publicFormUrl = `${appUrl}/apply/${rawToken}`;
    const assignedStaff = assignee
      ? [assignee.firstName, assignee.lastName].filter(Boolean).join(' ') || assignee.email
      : 'Unassigned';
    const n8nAvailability = this.n8n.getIntakeAvailability();
    const deferred = dto.sendIntakeImmediately === false;

    const created = await this.prisma.$transaction(async (transaction) => {
      let template = await transaction.cfFormTemplate.findFirst({
        where: { organizationId: organization.id, scope: 'master_core', isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      if (!template) {
        template = await transaction.cfFormTemplate.upsert({
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
        });
      }

      const dueAt = new Date(now.getTime() + template.dueInDays * 86_400_000);
      const client = await transaction.cfClient.create({
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
      });
      const assignment = await transaction.cfFormAssignment.create({
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
      });
      await transaction.cfActivityLog.create({
        data: {
          organizationId: organization.id,
          clientId: client.id,
          actorUserId: assignee?.id ?? null,
          action: 'CLIENT_CREATED',
          description: 'Client created and General Intake assigned.',
          user: assignedStaff,
        },
      });
      if (deferred) {
        await transaction.cfActivityLog.create({
          data: {
            organizationId: organization.id,
            clientId: client.id,
            actorUserId: assignee?.id ?? null,
            action: 'INTAKE_EMAIL_DEFERRED',
            description: 'Intake email send deferred by staff at creation.',
            user: 'system',
          },
        });
      } else if (n8nAvailability !== 'ready') {
        await transaction.cfActivityLog.create({
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
        });
      }
      return { client, assignment, template, dueAt };
    });

    const emailDelivery: IntakeEmailDeliveryResult | DeferredEmailDelivery = deferred
      ? { status: 'deferred' }
      : await this.n8n.sendIntake(`intake-${created.assignment.id}`, {
          eventType: 'intake.send',
          organizationId: organization.id,
          clientId: created.client.id,
          recipientEmail: created.client.email,
          clientName: created.client.primaryContactName,
          formName: 'General Intake Form',
          formUrl: publicFormUrl,
          dueDate: created.dueAt.toISOString(),
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
    this.assertClientAccessEnabled();
    const clients = await this.prisma.cfClient.findMany({
      where: { organizationId, isArchived: false, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return clients.map((client) => this.safeClient(client));
  }

  async getOne(id: string) {
    this.assertClientAccessEnabled();
    const client = await this.prisma.cfClient.findFirst({ where: { id, isArchived: false } });
    if (!client) throw new NotFoundException('Client not found.');

    const [program, contract, monitoringTask] = await Promise.all([
      client.programId
        ? this.prisma.cfProgram.findFirst({
            where: { id: client.programId, organizationId: client.organizationId },
          })
        : Promise.resolve(null),
      this.prisma.cfContract.findFirst({
        where: { clientId: client.id, organizationId: client.organizationId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cfMonitoringTask.findFirst({
        where: { clientId: client.id, organizationId: client.organizationId },
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

  async updateProgram(id: string, programId: string) {
    this.assertClientAccessEnabled();
    const client = await this.prisma.cfClient.findFirst({ where: { id, isArchived: false } });
    if (!client) throw new NotFoundException('Client not found.');

    const program = await this.prisma.cfProgram.findFirst({
      where: { id: programId, organizationId: client.organizationId, isActive: true },
    });
    if (!program) throw new NotFoundException('Program not found.');

    const previousProgramId = client.programId;
    await this.prisma.$transaction(async (transaction) => {
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

    return this.contracts.handlePostIntakeProgramSelection(client.id, program.id);
  }

  async sendIntakeNow(id: string) {
    this.assertClientAccessEnabled();
    const assignment = await this.prisma.cfFormAssignment.findFirst({
      where: { clientId: id, cancelledAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!assignment) throw new NotFoundException('No intake assignment found for this client.');
    const client = await this.prisma.cfClient.findFirst({
      where: { id, organizationId: assignment.organizationId, isArchived: false },
    });
    if (!client) throw new NotFoundException('Client not found.');

    // secureLinkToken only ever stores a hash, so a fresh raw token must be rotated in to link the client.
    const rawToken = generatePublicToken();
    await this.prisma.cfFormAssignment.update({
      where: { id: assignment.id },
      data: { secureLinkToken: hashPublicToken(rawToken) },
    });

    const appUrl = this.config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    const publicFormUrl = `${appUrl}/apply/${rawToken}`;
    const emailDelivery = await this.n8n.sendIntake(`intake-${assignment.id}-manual`, {
      eventType: 'intake.send',
      organizationId: client.organizationId,
      clientId: client.id,
      recipientEmail: client.email,
      clientName: client.primaryContactName,
      formName: 'General Intake Form',
      formUrl: publicFormUrl,
      dueDate: (assignment.dueAt ?? new Date()).toISOString(),
    });
    await this.prisma.cfActivityLog.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        actorUserId: client.assignedUserId,
        action: emailDelivery.status === 'sent' ? 'INTAKE_EMAIL_SENT' : 'INTAKE_EMAIL_FAILED',
        description: emailDelivery.status === 'sent'
          ? 'General Intake email sent by staff.'
          : `General Intake email delivery failed or skipped: ${emailDelivery.status}.`,
        user: 'staff',
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
