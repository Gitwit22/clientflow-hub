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
      formUrl: expect.stringMatching(/^https:\/\/clientflow\.example\.com\/s\/[A-Za-z0-9_-]{43}$/),
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

  describe('sendIntakeNow', () => {
    const assignment = {
      id: 'assignment-1',
      organizationId: 'org-1',
      clientId: 'client-1',
      formId: 'master-template-1',
      secureLinkToken: 'stale-hash',
      dueAt: new Date('2030-01-08T00:00:00.000Z'),
      expiresAt: null,
    };
    const client = {
      id: 'client-1',
      organizationId: 'org-1',
      email: 'alicia@example.com',
      primaryContactName: 'Alicia Owner',
      assignedUserId: null,
      isDemo: false,
    };
    const actor = { id: 'admin-1', name: 'Jordan Lee' };

    function build(overrides: Record<string, unknown> = {}, delivery: unknown = { status: 'sent', sentAt: '2030-01-01T00:00:00.000Z' }) {
      const prisma = {
        cfFormAssignment: {
          findFirst: jest.fn().mockResolvedValue(assignment),
          update: jest.fn().mockResolvedValue({ ...assignment, secureLinkToken: 'new-hash' }),
        },
        cfFormTemplate: { findMany: jest.fn().mockResolvedValue([{ id: 'master-template-1' }]) },
        cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
        cfCommunication: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...data })),
          update: jest.fn().mockResolvedValue({}),
        },
        cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
        ...overrides,
      };
      const n8n = {
        getIntakeAvailability: jest.fn().mockReturnValue('ready'),
        sendIntake: jest.fn().mockResolvedValue(delivery),
      };
      const service = new ClientsService(
        prisma as unknown as PrismaService,
        configService(),
        n8n as unknown as N8nService,
        contractsServiceMock(),
      );
      return { service, prisma, n8n };
    }

    it('rotates a fresh token and sends with a communication-based event id', async () => {
      const { service, prisma, n8n } = build();

      await service.sendIntakeNow('client-1', { actor, idempotencyKey: 'attempt-0001-abcd' });

      expect(prisma.cfFormAssignment.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'assignment-1' },
        data: { secureLinkToken: expect.stringMatching(/^[a-f0-9]{64}$/) },
      }));
      const created = (prisma.cfCommunication.create.mock.calls as [{ data: { id: string; eventId: string } }][])[0][0].data;
      expect(created.eventId).toBe(`intake.send:assignment-1:${created.id}`);
      expect(n8n.sendIntake).toHaveBeenCalledWith(created.eventId, expect.objectContaining({
        formUrl: expect.stringMatching(/^https:\/\/clientflow\.example\.com\/s\/[A-Za-z0-9_-]{43}$/),
        sentByUserId: 'admin-1',
      }));
    });

    it('only ever resends the general-intake assignment, never a newer program form', async () => {
      const { service, prisma } = build();
      await service.sendIntakeNow('client-1', { actor });
      const where = (prisma.cfFormAssignment.findFirst.mock.calls as [{ where: { formId: { in: string[] } } }][])[0][0].where;
      expect(where.formId.in).toEqual(expect.arrayContaining(['master-template-1']));
      expect(where.formId.in).toHaveLength(2); // generated general-intake id + master_core templates
      expect(prisma.cfFormTemplate.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', scope: 'master_core' },
        select: { id: true },
      });
    });

    it('records the attempt: communication row, staff activity and source', async () => {
      const { service, prisma } = build();
      await service.sendIntakeNow('client-1', { actor, idempotencyKey: 'attempt-0001-abcd' });

      expect(prisma.cfCommunication.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'intake_email',
          source: 'manual_staff_action',
          idempotencyKey: 'attempt-0001-abcd',
          staffMember: 'Jordan Lee',
          formAssignmentId: 'assignment-1',
        }),
      });
      expect(prisma.cfCommunication.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }));
      expect(prisma.cfActivityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'INTAKE_EMAIL_SENT', user: 'Jordan Lee', actorUserId: 'admin-1', source: 'manual_staff_action',
        }),
      });
    });

    it('records a skipped/failed delivery instead of losing it', async () => {
      const { service, prisma } = build({}, { status: 'skipped', reason: 'disabled' });
      const result = await service.sendIntakeNow('client-1', { actor });

      expect(result.emailDelivery).toEqual({ status: 'skipped', reason: 'disabled' });
      expect(prisma.cfCommunication.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', errorCode: 'disabled' }),
      }));
      expect(prisma.cfActivityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'INTAKE_EMAIL_FAILED' }),
      });
    });

    it('a retried request (same Idempotency-Key) returns the first attempt and sends nothing', async () => {
      const prior = {
        id: 'comm-1', status: 'SENT', sentAt: new Date('2030-01-01T00:00:00.000Z'), errorCode: null,
        contractId: null, formAssignmentId: 'assignment-1', type: 'intake_email',
      };
      const { service, prisma, n8n } = build({
        cfCommunication: { findFirst: jest.fn().mockResolvedValue(prior), create: jest.fn(), update: jest.fn() },
      });

      const result = await service.sendIntakeNow('client-1', { actor, idempotencyKey: 'attempt-0001-abcd' });

      expect(result).toEqual({
        emailDelivery: { status: 'sent', sentAt: '2030-01-01T00:00:00.000Z' },
        replayed: true,
      });
      expect(n8n.sendIntake).not.toHaveBeenCalled();
      expect(prisma.cfFormAssignment.update).not.toHaveBeenCalled(); // token not rotated again
      expect(prisma.cfCommunication.create).not.toHaveBeenCalled();
    });

    it('reports a clear error when the client has no general-intake assignment', async () => {
      const { service, n8n } = build({
        cfFormAssignment: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      });
      await expect(service.sendIntakeNow('client-1', { actor })).rejects.toThrow(
        'No General Intake assignment found for this client.',
      );
      expect(n8n.sendIntake).not.toHaveBeenCalled();
    });
  });
});
