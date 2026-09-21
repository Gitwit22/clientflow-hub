import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/clientflow';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractsService } from '../contracts/contracts.service';
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
    private readonly contracts: ContractsService,
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
      if (field.required && (value === undefined || value === null || value === '')) {
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
    const preparedProgram = program
      ? await this.contracts.prepareProgramSelection(assignment.organizationId, program)
      : null;
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
          programId: preparedProgram?.program.id ?? null,
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

    const postIntake = preparedProgram
      ? await this.contracts.handlePostIntakeProgramSelection(client.id, preparedProgram.program.id)
      : null;

    return {
      success: true,
      clientId: client.id,
      assignmentId: assignment.id,
      status: postIntake?.clientStatus ?? status,
      selectedProgram: program,
      program: postIntake?.program ?? null,
      nextAction: postIntake?.nextAction ?? null,
      contract: postIntake?.contract ?? null,
      emailDelivery: postIntake?.emailDelivery ?? null,
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
}
