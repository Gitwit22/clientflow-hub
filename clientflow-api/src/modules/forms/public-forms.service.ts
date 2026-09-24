import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/clientflow';
import { ProgramAutomationService } from '../automation/program-automation.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PublicAnswer, SubmitPublicFormDto } from './dto/submit-public-form.dto';
import {
  CLIENT_STATUS,
  FORM_STATUS,
  hashPublicToken,
  isProgramOption,
  publicIntakeFields,
} from './intake-lifecycle';

const SAFE_NOT_FOUND_MESSAGE = 'This form link is invalid or unavailable.';

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

@Injectable()
export class PublicFormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automation: ProgramAutomationService,
  ) {}

  async getByToken(token: string) {
    const { assignment, client, template } = await this.resolveToken(token);
    const fields = publicIntakeFields(template.fields);

    return {
      assignment: {
        id: assignment.id,
        status: assignment.status,
        dueDate: assignment.dueDate,
        sentAt: assignment.sentAt,
        submittedAt: assignment.submittedAt,
      },
      form: {
        id: template.id,
        name: template.name,
        description: template.description,
        fields,
      },
      prefill: {
        contactName: client.primaryContactName,
        businessName: client.businessName,
        email: client.email,
        phone: client.phone,
      },
    };
  }

  async submit(token: string, dto: SubmitPublicFormDto) {
    const { assignment, client, template } = await this.resolveToken(token);
    if (assignment.status === FORM_STATUS.submitted || assignment.submittedAt) {
      throw new ConflictException('This form has already been submitted.');
    }

    const fields = publicIntakeFields(template.fields);
    const fieldsById = new Map(fields.map((field) => [field.id, field]));
    const unknownField = Object.keys(dto.answers).find((fieldId) => !fieldsById.has(fieldId));
    if (unknownField) throw new BadRequestException('One or more answers do not belong to this form.');

    for (const field of fields) {
      const value = dto.answers[field.id];
      const isMissing = field.required && (
        value === undefined || value === null || value === ''
        || (Array.isArray(value) && value.length === 0)
        || (field.type === 'checkbox' && value !== true)
      );
      if (isMissing) {
        throw new BadRequestException(`Please complete: ${field.label}.`);
      }
      this.validateAnswer(field.id, field.type, field.options, value);
    }

    const selectedProgram = dto.answers['selectedProgram'];
    if (selectedProgram !== undefined && selectedProgram !== null && selectedProgram !== ''
      && !isProgramOption(selectedProgram)) {
      throw new BadRequestException('Selected program is invalid.');
    }
    const program = isProgramOption(selectedProgram) ? selectedProgram : null;
    const status = program ? CLIENT_STATUS.programSelected : CLIENT_STATUS.intakeSubmitted;
    const selectedDbProgram = program
      ? await this.prisma.cfProgram.findFirst({
          where: { organizationId: assignment.organizationId, name: program, isActive: true },
          select: { id: true, name: true },
        })
      : null;
    if (program && !selectedDbProgram) throw new BadRequestException('Selected program is invalid.');
    const submittedAt = new Date();

    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.cfFormAssignment.updateMany({
        where: { id: assignment.id, submittedAt: null },
        data: { responses: dto.answers, status: FORM_STATUS.submitted, submittedAt },
      });
      if (updated.count !== 1) throw new ConflictException('This form has already been submitted.');

      await transaction.cfClient.update({
        where: { id: client.id },
        data: {
          status,
          programId: selectedDbProgram?.id ?? null,
          intake: {
            ...jsonObject(client.intake),
            ...(program ? { programOfInterest: program } : {}),
          },
        },
      });
      await transaction.cfActivityLog.create({
        data: {
          organizationId: assignment.organizationId,
          clientId: client.id,
          action: 'INTAKE_SUBMITTED',
          description: program
            ? `General Intake submitted with program selection: ${program}.`
            : 'General Intake submitted without a program selection.',
          user: 'public form',
        },
      });
    });

    await this.createAdminNotifications({
      organizationId: assignment.organizationId,
      clientId: client.id,
      submissionId: assignment.id,
      sourceType: 'intake_submission',
      sourceId: assignment.id,
      type: 'INTAKE_SUBMITTED',
      title: 'Intake submitted',
      message: program
        ? `${client.primaryContactName} submitted intake and selected ${program}.`
        : `${client.primaryContactName} submitted intake without choosing a program.`,
      actionUrl: `/clients/${client.id}?tab=forms`,
      isDemo: client.isDemo,
    });

    const automation = selectedDbProgram
      ? await this.automation.runTrigger({
          organizationId: assignment.organizationId,
          clientId: client.id,
          trigger: 'intake.submitted',
          programIds: [selectedDbProgram.id],
          actorDisplayName: 'public form',
          idempotencySeed: `public-form-intake:${assignment.id}:${submittedAt.toISOString()}`,
          payload: { selectedProgramIds: [selectedDbProgram.id] },
        })
      : null;

    return {
      success: true,
      clientId: client.id,
      assignmentId: assignment.id,
      status,
      selectedProgram: program,
      program: selectedDbProgram ?? null,
      automation,
    };
  }

  private async resolveToken(token: string) {
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) throw new NotFoundException(SAFE_NOT_FOUND_MESSAGE);
    const assignment = await this.prisma.cfFormAssignment.findUnique({
      where: { secureLinkToken: hashPublicToken(token) },
    });
    if (!assignment || assignment.cancelledAt || !assignment.expiresAt
      || assignment.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException(SAFE_NOT_FOUND_MESSAGE);
    }

    const [client, template] = await Promise.all([
      this.prisma.cfClient.findFirst({
        where: { id: assignment.clientId, organizationId: assignment.organizationId, isArchived: false },
      }),
      this.prisma.cfFormTemplate.findFirst({
        where: { id: assignment.formId, organizationId: assignment.organizationId, isActive: true },
      }),
    ]);
    if (!client || !template) throw new NotFoundException(SAFE_NOT_FOUND_MESSAGE);
    return { assignment, client, template };
  }

  private validateAnswer(
    fieldId: string,
    type: string,
    options: readonly string[] | undefined,
    value: PublicAnswer | undefined,
  ): void {
    if (value === undefined || value === null || value === '') return;
    if (type === 'social_links') {
      if (!Array.isArray(value) || value.length > 10) {
        throw new BadRequestException(`Answer for ${fieldId} is invalid.`);
      }
      for (const link of value) {
        if (typeof link !== 'string' || !link.trim()) {
          throw new BadRequestException(`Answer for ${fieldId} is invalid.`);
        }
        try {
          const url = new URL(link.trim());
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
        } catch {
          throw new BadRequestException(`Answer for ${fieldId} contains an invalid link.`);
        }
      }
      return;
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new BadRequestException(`Answer for ${fieldId} is invalid.`);
    }
    if (type === 'email' && (typeof value !== 'string' || !/^\S+@\S+\.\S+$/.test(value))) {
      throw new BadRequestException(`Answer for ${fieldId} must be an email address.`);
    }
    if (type === 'select' && options && (typeof value !== 'string' || !options.includes(value))) {
      throw new BadRequestException(`Answer for ${fieldId} is not an allowed option.`);
    }
  }

  private async createAdminNotifications(payload: {
    organizationId: string;
    clientId: string;
    submissionId: string;
    sourceType: string;
    sourceId: string;
    type: string;
    title: string;
    message: string;
    actionUrl: string;
    isDemo: boolean;
  }) {
    const adminModel = (this.prisma as unknown as {
      adminUser?: { findMany: (args: unknown) => Promise<Array<{ id: string }>> };
      cfNotification?: {
        createMany?: (args: unknown) => Promise<unknown>;
        create?: (args: unknown) => Promise<unknown>;
      };
    }).adminUser;
    const notificationModel = (this.prisma as unknown as {
      cfNotification?: {
        createMany?: (args: unknown) => Promise<unknown>;
        create?: (args: unknown) => Promise<unknown>;
      };
    }).cfNotification;
    if (!adminModel || !notificationModel) return;
    const admins = await adminModel.findMany({
      where: {
        organizationId: payload.organizationId,
        isActive: true,
        role: { in: ['org_admin', 'super_admin'] },
      },
      select: { id: true },
    });
    if (admins.length === 0) return;
    const data = admins.map((admin) => ({
      organizationId: payload.organizationId,
      recipientAdminId: admin.id,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      actionUrl: payload.actionUrl,
      sourceType: payload.sourceType,
      sourceId: payload.sourceId,
      clientId: payload.clientId,
      submissionId: payload.submissionId,
      isDemo: payload.isDemo,
    }));
    if (notificationModel.createMany) {
      await notificationModel.createMany({ data, skipDuplicates: true });
      return;
    }
    await Promise.all(data.map(async (item) => {
      try {
        await notificationModel.create?.({ data: item });
      } catch {
        // ignore duplicates in minimal mocks
      }
    }));
  }
}
