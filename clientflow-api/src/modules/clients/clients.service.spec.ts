import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { ClientsService } from './clients.service';

function configService(): ConfigService<Environment, true> {
  const values: Record<string, string> = {
    ALLOW_UNAUTHENTICATED_CLIENT_CREATION: 'true',
    APP_URL: 'https://clientflow.example.com',
  };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService<Environment, true>;
}

describe('ClientsService', () => {
  it('creates a client, intake assignment, and skipped-email activity when n8n is disabled', async () => {
    const template = {
      id: 'form-1',
      name: 'Existing General Intake',
      dueInDays: 7,
    };
    const client = {
      id: 'client-1',
      organizationId: 'org-1',
      primaryContactName: 'Alicia Owner',
      businessName: 'Alicia Studio',
      email: 'alicia@example.com',
      phone: '',
      status: 'INTAKE_SENT',
    };
    const assignment = {
      id: 'assignment-1',
      status: 'sent',
      dueDate: '2030-01-08',
      sentAt: new Date('2030-01-01T00:00:00.000Z'),
      submittedAt: null,
    };
    const transaction = {
      cfFormTemplate: {
        findFirst: jest.fn().mockResolvedValue(template),
        upsert: jest.fn(),
      },
      cfClient: { create: jest.fn().mockResolvedValue(client) },
      cfFormAssignment: { create: jest.fn().mockResolvedValue(assignment) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
    };
    const prisma = {
      organization: { findFirst: jest.fn().mockResolvedValue({ id: 'org-1' }) },
      adminUser: { findFirst: jest.fn() },
      cfActivityLog: { create: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService;
    const n8n = {
      getIntakeAvailability: jest.fn().mockReturnValue('disabled'),
      sendIntake: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'disabled' }),
    } as unknown as N8nService;
    const service = new ClientsService(prisma, configService(), n8n);

    const result = await service.create({
      organizationId: 'org-1',
      contactName: ' Alicia Owner ',
      businessName: ' Alicia Studio ',
      email: 'ALICIA@EXAMPLE.COM',
    });

    expect(transaction.cfFormTemplate.upsert).not.toHaveBeenCalled();
    expect(transaction.cfClient.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'INTAKE_SENT', email: 'alicia@example.com' }),
    }));
    expect(transaction.cfFormAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clientId: 'client-1',
        formId: 'form-1',
        status: 'sent',
        secureLinkToken: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
    expect(transaction.cfActivityLog.create).toHaveBeenCalledTimes(2);
    expect(n8n.sendIntake).toHaveBeenCalledWith('intake-assignment-1', expect.objectContaining({
      eventType: 'intake.send',
      clientId: 'client-1',
      formUrl: expect.stringMatching(/^https:\/\/clientflow\.example\.com\/s\/[A-Za-z0-9_-]{43}$/),
    }));
    expect(result.emailDelivery).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(result.assignment.id).toBe('assignment-1');
  });
});
