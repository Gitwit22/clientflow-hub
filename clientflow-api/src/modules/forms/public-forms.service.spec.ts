import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
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
  };
}

describe('PublicFormsService', () => {
  it('opens a valid token using only its stored hash', async () => {
    const prisma = readPrisma();
    const service = new PublicFormsService(prisma as unknown as PrismaService);

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
    const service = new PublicFormsService(readPrisma() as unknown as PrismaService);

    await expect(service.getByToken('invalid')).rejects.toEqual(
      new NotFoundException('This form link is invalid or unavailable.'),
    );
  });

  it('submits the assignment and updates client program status atomically', async () => {
    const transaction = {
      cfFormAssignment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cfClient: { update: jest.fn().mockResolvedValue({ id: 'client-1' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
    };
    const prisma = {
      ...readPrisma(),
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new PublicFormsService(prisma as unknown as PrismaService);

    const result = await service.submit(rawToken, {
      answers: {
        contactName: 'Alicia Owner',
        email: 'alicia@example.com',
        selectedProgram: 'Grant',
      },
    });

    expect(transaction.cfFormAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'assignment-1', submittedAt: null },
      data: expect.objectContaining({ status: 'submitted' }),
    }));
    expect(transaction.cfClient.update).toHaveBeenCalledWith({
      where: { id: 'client-1' },
      data: {
        status: 'PROGRAM_SELECTED',
        intake: { referralSource: 'event', programOfInterest: 'Grant' },
      },
    });
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'INTAKE_SUBMITTED' }),
    }));
    expect(result).toEqual(expect.objectContaining({
      success: true,
      status: 'PROGRAM_SELECTED',
      selectedProgram: 'Grant',
    }));
  });
});
