import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PublicAnswer, SubmitPublicFormDto } from './dto/submit-public-form.dto';
import { IntakeWorkflowService } from './intake-workflow.service';
import { type PublicFormLinkMode, resolvePublicFormLink } from './public-form-link';
import {
  CLIENT_STATUS,
  FORM_STATUS,
  isProgramOption,
  publicIntakeFields,
} from './intake-lifecycle';



@Injectable()
export class PublicFormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intake: IntakeWorkflowService,
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
    const { assignment, client, template } = await this.resolveToken(token, 'submit');
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
    const selectedDbProgram = program
      ? await this.prisma.cfProgram.findFirst({
          where: { organizationId: assignment.organizationId, name: program, isActive: true },
          select: { id: true, name: true },
        })
      : null;
    if (program && !selectedDbProgram) throw new BadRequestException('Selected program is invalid.');

    // Adapter: the intake workflow records the submission (one transaction, idempotent).
    const result = await this.intake.submit(token, {
      coreResponses: dto.answers,
      selectedProgramIds: selectedDbProgram ? [selectedDbProgram.id] : [],
      actorDisplayName: 'public form',
    });

    return {
      success: true,
      clientId: client.id,
      assignmentId: assignment.id,
      status: program ? CLIENT_STATUS.programSelected : CLIENT_STATUS.intakeSubmitted,
      selectedProgram: program,
      program: selectedDbProgram ?? null,
      automation: result.automation,
    };
  }

  private async resolveToken(token: string, mode: PublicFormLinkMode = 'view') {
    return resolvePublicFormLink(this.prisma, token, mode);
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
}
