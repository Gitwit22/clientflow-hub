import type { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import type { Environment } from '../../config/env';
import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ContractsService } from '../contracts/contracts.service';
import { ClientsService } from './clients.service';

function configService(): ConfigService<Environment, true> {
  const values: Record<string, string> = {
    ALLOW_UNAUTHENTICATED_CLIENT_CREATION: 'true',
    APP_URL: 'https://clientflow.example.com',
  };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService<Environment, true>;
}

function contractsServiceMock() {
  return {
    handlePostIntakeProgramSelection: jest.fn().mockResolvedValue({
      nextAction: 'STAFF_REVIEW_REQUIRED',
      clientStatus: 'PENDING_STAFF_REVIEW',
      program: { id: 'program-2', name: 'Grant' },
      contract: null,
      emailDelivery: null,
    }),
  } as unknown as ContractsService;
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
      formId: 'form-1',
      status: 'sent',
      dueDate: '2030-01-08',
      sentAt: new Date('2030-01-01T00:00:00.000Z'),
      submittedAt: null,
      expiresAt: null,
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
    const service = new ClientsService(prisma, configService(), n8n, contractsServiceMock());

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
      clientId: 'client-1',
      formId: 'form-1',
      sentByUserId: 'system',
      formUrl: expect.stringMatching(/^https:\/\/clientflow\.example\.com\/apply\/[A-Za-z0-9_-]{43}$/),
    }));
    expect(result.emailDelivery).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(result.assignment.id).toBe('assignment-1');
  });

  it('defers the intake email when sendIntakeImmediately is false', async () => {
    const template = { id: 'form-1', name: 'Existing General Intake', dueInDays: 7 };
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
      cfFormTemplate: { findFirst: jest.fn().mockResolvedValue(template), upsert: jest.fn() },
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
      sendIntake: jest.fn(),
    } as unknown as N8nService;
    const service = new ClientsService(prisma, configService(), n8n, contractsServiceMock());

    const result = await service.create({
      organizationId: 'org-1',
      contactName: 'Alicia Owner',
      email: 'alicia@example.com',
      sendIntakeImmediately: false,
    });

    expect(n8n.sendIntake).not.toHaveBeenCalled();
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'INTAKE_EMAIL_DEFERRED' }),
    }));
    expect(result.emailDelivery).toEqual({ status: 'deferred' });
  });

  it('lists clients scoped to an organization and optional status', async () => {
    const clients = [{
      id: 'client-1',
      organizationId: 'org-1',
      primaryContactName: 'Alicia Owner',
      businessName: 'Alicia Studio',
      email: 'alicia@example.com',
      phone: '',
      programId: null,
      status: 'PENDING_STAFF_REVIEW',
      assignedStaff: 'Unassigned',
      assignedUserId: null,
      createdAt: new Date('2030-01-01T00:00:00.000Z'),
      updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    }];
    const prisma = {
      cfClient: { findMany: jest.fn().mockResolvedValue(clients) },
    } as unknown as PrismaService;
    const service = new ClientsService(prisma, configService(), {} as N8nService, contractsServiceMock());

    const result = await service.list('org-1', 'PENDING_STAFF_REVIEW');

    expect(prisma.cfClient.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', isArchived: false, status: 'PENDING_STAFF_REVIEW' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual([expect.objectContaining({ id: 'client-1', status: 'PENDING_STAFF_REVIEW' })]);
  });

  it('throws when getting a client that does not exist', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new ClientsService(prisma, configService(), {} as N8nService, contractsServiceMock());

    await expect(service.getOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the executed document URL alongside the contract once archived', async () => {
    const client = {
      id: 'client-1',
      organizationId: 'org-1',
      primaryContactName: 'Alicia Owner',
      businessName: 'Alicia Studio',
      email: 'alicia@example.com',
      phone: '',
      programId: 'program-1',
      status: 'ONBOARDING',
      assignedStaff: 'Unassigned',
      assignedUserId: null,
      createdAt: new Date('2030-01-01T00:00:00.000Z'),
      updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    };
    const contract = {
      id: 'contract-1',
      status: 'COMPLETED',
      contractType: 'Grant Agreement',
      sentAt: new Date('2030-01-01T00:00:00.000Z'),
      completedAt: new Date('2030-01-02T00:00:00.000Z'),
      staffSignedByName: 'Jordan Staff',
      staffSignedAt: new Date('2030-01-01T00:00:00.000Z'),
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      generatedContent: 'Full executed contract text.',
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue({ id: 'program-1', name: 'Grant' }) },
      cfContract: { findFirst: jest.fn().mockResolvedValue(contract) },
      cfMonitoringTask: { findFirst: jest.fn().mockResolvedValue(null) },
      cfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          url: 'https://pub-account.r2.dev/contracts/org-1/client-1/contract-1-executed.txt',
        }),
      },
    } as unknown as PrismaService;
    const service = new ClientsService(prisma, configService(), {} as N8nService, contractsServiceMock());

    const result = await service.getOne('client-1');

    expect(result.contract).toEqual(expect.objectContaining({
      documentUrl: 'https://pub-account.r2.dev/contracts/org-1/client-1/contract-1-executed.txt',
      content: 'Full executed contract text.',
    }));
  });

  it('updates a client program and re-runs the contract rule engine', async () => {
    const client = {
      id: 'client-1',
      organizationId: 'org-1',
      programId: 'program-1',
      assignedUserId: null,
    };
    const program = { id: 'program-2', organizationId: 'org-1', name: 'Grant', isActive: true };
    const transaction = {
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, programId: 'program-2' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(program) },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService;
    const contracts = contractsServiceMock();
    const service = new ClientsService(prisma, configService(), {} as N8nService, contracts);

    const result = await service.updateProgram('client-1', 'program-2');

    expect(transaction.cfClient.update).toHaveBeenCalledWith({
      where: { id: 'client-1' },
      data: { programId: 'program-2' },
    });
    expect(contracts.handlePostIntakeProgramSelection).toHaveBeenCalledWith('client-1', 'program-2');
    expect(result).toEqual(expect.objectContaining({ clientStatus: 'PENDING_STAFF_REVIEW' }));
  });

  it('rotates a fresh token when sending a deferred intake email', async () => {
    const assignment = {
      id: 'assignment-1',
      organizationId: 'org-1',
      secureLinkToken: 'stale-hash',
      dueAt: new Date('2030-01-08T00:00:00.000Z'),
    };
    const client = {
      id: 'client-1',
      organizationId: 'org-1',
      email: 'alicia@example.com',
      primaryContactName: 'Alicia Owner',
      assignedUserId: null,
    };
    const prisma = {
      cfFormAssignment: {
        findFirst: jest.fn().mockResolvedValue(assignment),
        update: jest.fn().mockResolvedValue({ ...assignment, secureLinkToken: 'new-hash' }),
      },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
    } as unknown as PrismaService;
    const n8n = {
      sendIntake: jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2030-01-01T00:00:00.000Z' }),
    } as unknown as N8nService;
    const service = new ClientsService(prisma, configService(), n8n, contractsServiceMock());

    await service.sendIntakeNow('client-1');

    expect(prisma.cfFormAssignment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'assignment-1' },
      data: { secureLinkToken: expect.stringMatching(/^[a-f0-9]{64}$/) },
    }));
    expect(n8n.sendIntake).toHaveBeenCalledWith('intake-assignment-1-manual', expect.objectContaining({
      formUrl: expect.stringMatching(/^https:\/\/clientflow\.example\.com\/apply\/[A-Za-z0-9_-]{43}$/),
    }));
  });
});
