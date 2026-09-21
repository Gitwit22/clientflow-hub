import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  PROGRAM_CONTRACT_RULES,
  contractRuleFor,
} from './contract-lifecycle';
import { ContractsService } from './contracts.service';

const now = new Date('2030-01-01T00:00:00.000Z');
const client = {
  id: 'client-1',
  organizationId: 'org-1',
  programId: 'program-1',
  primaryContactName: 'Client Owner',
  email: 'client@example.com',
  assignedUserId: null,
  isArchived: false,
  isDemo: false,
};
const autoProgram = {
  id: 'program-1',
  organizationId: 'org-1',
  name: 'Brand Awareness Subscription',
  defaultContractTemplateId: 'Brand Awareness Service Agreement',
  isActive: true,
};
const reviewProgram = {
  ...autoProgram,
  name: 'Grant',
  defaultContractTemplateId: 'Grant Agreement',
};
const template = {
  id: 'template-1',
  organizationId: 'org-1',
  name: 'Brand Awareness Service Agreement',
  content: 'Draft agreement content.',
  isActive: true,
};
const draftContract = {
  id: 'contract-1',
  organizationId: 'org-1',
  clientId: 'client-1',
  programId: 'program-1',
  contractTemplateId: 'template-1',
  contractType: template.name,
  status: 'DRAFT',
  secureTokenHash: 'a'.repeat(64),
  secureTokenExpiresAt: new Date('2030-01-08T00:00:00.000Z'),
  sentAt: null,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};
const sentContract = {
  ...draftContract,
  status: 'SENT',
  sentAt: now,
};

function config(enabled = true): ConfigService<Environment, true> {
  const values: Record<string, string> = {
    ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT: enabled ? 'true' : 'false',
    APP_URL: 'https://clientflow.example.com',
  };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService<Environment, true>;
}

function n8nDisabled() {
  return {
    getContractAvailability: jest.fn().mockReturnValue('disabled'),
    sendContract: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'disabled' }),
  };
}

describe('contract lifecycle rules', () => {
  it('classifies both auto-contract and all staff-review programs', () => {
    expect(Object.keys(PROGRAM_CONTRACT_RULES)).toHaveLength(8);
    expect(contractRuleFor('Brand Awareness Subscription')).toBe('auto_contract');
    expect(contractRuleFor('30-Day Premier Workshop Subscription')).toBe('auto_contract');
    for (const programName of [
      'Event Planning',
      'Commercial Property',
      'Grant',
      'Sponsorship',
      'Interest',
      'Other / Unsure',
    ]) {
      expect(contractRuleFor(programName)).toBe('staff_review');
    }
  });
});

describe('ContractsService', () => {
  it('places a staff-review program in review without creating a contract', async () => {
    const transaction = {
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'PENDING_STAFF_REVIEW' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(reviewProgram) },
      cfContract: { create: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    const result = await service.handlePostIntakeProgramSelection('client-1', 'program-1');

    expect(transaction.cfClient.update).toHaveBeenCalledWith({
      where: { id: 'client-1' },
      data: { status: 'PENDING_STAFF_REVIEW' },
    });
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: 'Pending staff review before contract' }),
    }));
    expect(prisma.cfContract.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextAction: 'STAFF_REVIEW_REQUIRED',
      clientStatus: 'PENDING_STAFF_REVIEW',
      contract: null,
    }));
  });

  it('auto-generates and issues a contract while safely skipping disabled n8n', async () => {
    const transaction = {
      cfContract: { update: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'skipped' }),
      },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfContractTemplate: { findMany: jest.fn().mockResolvedValue([template]) },
      cfContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(draftContract),
      },
      cfCommunication: { update: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const n8n = n8nDisabled();
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8n as unknown as N8nService,
    );

    const result = await service.handlePostIntakeProgramSelection('client-1', 'program-1');

    expect(prisma.cfContract.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'DRAFT',
        secureTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        generatedContent: expect.stringContaining('Template draft only.'),
      }),
    }));
    expect(transaction.cfContract.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'SENT',
        secureTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
    expect(transaction.cfCommunication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'skipped', errorCode: 'disabled' }),
    }));
    expect(n8n.sendContract).toHaveBeenCalledWith(expect.stringMatching(/^contract\.send:/), expect.objectContaining({
      eventType: 'contract.send',
      dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
    expect(result).toEqual(expect.objectContaining({
      nextAction: 'CONTRACT_SENT',
      clientStatus: 'CONTRACT_SENT',
      emailDelivery: { status: 'skipped', reason: 'disabled' },
    }));
    expect(JSON.stringify(result)).not.toContain('secureTokenHash');
  });

  it('generates a safe draft projection with a one-time URL', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfContractTemplate: { findMany: jest.fn().mockResolvedValue([template]) },
      cfContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(draftContract),
      },
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    const result = await service.generateForStaff('client-1');

    expect(result.publicContractUrl).toMatch(/^https:\/\/clientflow\.example\.com\/contracts\/[A-Za-z0-9_-]{43}$/);
    expect(result.contract).toEqual(expect.objectContaining({ id: 'contract-1', status: 'DRAFT' }));
    expect(JSON.stringify(result)).not.toContain('secureTokenHash');
  });

  it('returns a safe error when the default contract template is missing', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfContractTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    await expect(service.generateForStaff('client-1')).rejects.toEqual(
      new BadRequestException('The selected program does not have an active contract template.'),
    );
  });

  it('sends an existing contract and records skipped delivery without exposing its hash', async () => {
    const transaction = {
      cfContract: { update: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'skipped' }),
      },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfContract: { findFirst: jest.fn().mockResolvedValue(draftContract) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfContractTemplate: { findFirst: jest.fn().mockResolvedValue(template) },
      cfCommunication: { update: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    const result = await service.sendForStaff('client-1', 'contract-1');

    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: 'Contract sent' }),
    }));
    expect(result.emailDelivery).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(JSON.stringify(result)).not.toContain('secureTokenHash');
  });

  it('records an enabled accepted n8n delivery as sent', async () => {
    const transaction = {
      cfContract: { update: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'requested' }),
      },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfContract: { findFirst: jest.fn().mockResolvedValue(draftContract) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfContractTemplate: { findFirst: jest.fn().mockResolvedValue(template) },
      cfCommunication: { update: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'sent' }) },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const n8n = {
      getContractAvailability: jest.fn().mockReturnValue('ready'),
      sendContract: jest.fn().mockResolvedValue({
        status: 'sent',
        sentAt: '2030-01-01T00:00:00.000Z',
      }),
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8n as unknown as N8nService,
    );

    await service.sendForStaff('client-1', 'contract-1');

    expect(transaction.cfCommunication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'requested', errorCode: null }),
    }));
    expect(prisma.cfCommunication.update).toHaveBeenCalledWith({
      where: { id: 'communication-1' },
      data: {
        status: 'sent',
        sentAt: new Date('2030-01-01T00:00:00.000Z'),
        failedAt: null,
        errorCode: null,
      },
    });
  });
});
