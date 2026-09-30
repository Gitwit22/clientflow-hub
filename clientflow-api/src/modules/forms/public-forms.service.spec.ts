import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { IntakeWorkflowService } from './intake-workflow.service';
import { hashPublicToken } from './intake-lifecycle';
import { PublicFormsService } from './public-forms.service';

const rawToken = 'A'.repeat(43);
const assignment = {
  id: 'assignment-1',
  organizationId: 'org-1',
  clientId: 'client-1',
  formId: 'form-1',
  status: 'sent',
  dueDate: '2030-01-08',
  sentAt: new Date('2030-01-01T00:00:00.000Z'),
  submittedAt: null,
  cancelledAt: null,
  expiresAt: new Date('2999-01-08T00:00:00.000Z'),
};
const client = {
  id: 'client-1',
  primaryContactName: 'Alicia Owner',
  businessName: 'Alicia Studio',
  email: 'alicia@example.com',
  phone: '',
  intake: { referralSource: 'event' },
};
const template = {
  id: 'form-1',
  name: 'General Intake Form',
  description: 'General intake',
  fields: [
    { id: 'contactName', label: 'Contact name', type: 'text', required: true },
    { id: 'email', label: 'Email', type: 'email', required: true },
  ],
};

function readPrisma() {
  return {
    cfFormAssignment: { findUnique: jest.fn().mockResolvedValue(assignment) },
    cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
    cfFormTemplate: { findFirst: jest.fn().mockResolvedValue(template) },
    cfProgram: { findFirst: jest.fn().mockResolvedValue({ id: 'program-1', name: 'Grant' }) },
  };
}

function intakeWorkflow() {
  return {
    submit: jest.fn().mockResolvedValue({
      success: true,
      submissionId: 'submission-1',
      clientId: 'client-1',
      assignmentId: 'assignment-1',
      enrollmentIds: ['enroll-1'],
      automation: { trigger: 'intake.submitted' },
    }),
  };
}

describe('PublicFormsService', () => {
  it('opens a valid token using only its stored hash', async () => {
    const prisma = readPrisma();
    const service = new PublicFormsService(
      prisma as unknown as PrismaService,
      intakeWorkflow() as unknown as IntakeWorkflowService,
    );

    const result = await service.getByToken(rawToken);

    expect(prisma.cfFormAssignment.findUnique).toHaveBeenCalledWith({
      where: { secureLinkToken: hashPublicToken(rawToken) },
    });
    expect(result.prefill).toEqual(expect.objectContaining({ email: 'alicia@example.com' }));
    expect(result.form.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'selectedProgram' }),
    ]));
  });

  it('returns the same safe error for an invalid token', async () => {
    const service = new PublicFormsService(
      readPrisma() as unknown as PrismaService,
      intakeWorkflow() as unknown as IntakeWorkflowService,
    );

    await expect(service.getByToken('invalid')).rejects.toEqual(
      new NotFoundException('This form link is invalid or unavailable.'),
    );
  });

  it('validates the answers, then records the submission through the intake workflow', async () => {
    const prisma = readPrisma();
    const intake = intakeWorkflow();
    const service = new PublicFormsService(
      prisma as unknown as PrismaService,
      intake as unknown as IntakeWorkflowService,
    );

    const answers = {
      contactName: 'Alicia Owner',
      email: 'alicia@example.com',
      selectedProgram: 'Grant',
    };
    const result = await service.submit(rawToken, { answers });

    // The program is chosen by name on this form and passed on by id, from this organization only.
    expect(prisma.cfProgram.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', name: 'Grant', isActive: true },
    }));
    expect(intake.submit).toHaveBeenCalledWith(rawToken, {
      coreResponses: answers,
      selectedProgramIds: ['program-1'],
      actorDisplayName: 'public form',
    });
    expect(result).toEqual(expect.objectContaining({
      success: true,
      status: 'PROGRAM_SELECTED',
      selectedProgram: 'Grant',
      program: { id: 'program-1', name: 'Grant' },
      automation: { trigger: 'intake.submitted' },
    }));
  });

  it('accepts a valid social_links array answer on a richer legacy-style template', async () => {
    const richTemplate = {
      ...template,
      fields: [
        ...template.fields,
        { id: 'socialLinks', label: 'Primary Social media', type: 'social_links', required: false },
      ],
    };
    const prisma = {
      ...readPrisma(),
      cfFormTemplate: { findFirst: jest.fn().mockResolvedValue(richTemplate) },
    };
    const service = new PublicFormsService(
      prisma as unknown as PrismaService,
      intakeWorkflow() as unknown as IntakeWorkflowService,
    );

    await expect(service.submit(rawToken, {
      answers: {
        contactName: 'Alicia Owner',
        email: 'alicia@example.com',
        socialLinks: ['https://instagram.com/alicia', 'https://facebook.com/alicia'],
      },
    })).resolves.toEqual(expect.objectContaining({ success: true }));
  });

  it('rejects a social_links answer containing a non-http(s) link', async () => {
    const richTemplate = {
      ...template,
      fields: [
        ...template.fields,
        { id: 'socialLinks', label: 'Primary Social media', type: 'social_links', required: false },
      ],
    };
    const prisma = {
      ...readPrisma(),
      cfFormTemplate: { findFirst: jest.fn().mockResolvedValue(richTemplate) },
    };
    const service = new PublicFormsService(
      prisma as unknown as PrismaService,
      intakeWorkflow() as unknown as IntakeWorkflowService,
    );

    await expect(service.submit(rawToken, {
      answers: {
        contactName: 'Alicia Owner',
        email: 'alicia@example.com',
        socialLinks: ['javascript:alert(1)'],
      },
    })).rejects.toThrow('Answer for socialLinks contains an invalid link.');
  });
});
