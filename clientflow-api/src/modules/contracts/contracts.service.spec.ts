import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { StorageService } from '../../integrations/storage/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { WorkflowConfigService } from '../programs/workflow-config.service';
import {
  PROGRAM_CONTRACT_RULES,
  contractRuleFor,
  monitoringDueDate,
  welcomeMessageFor,
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
const workflowConfig = {
  id: 'workflow-1',
  organizationId: 'org-1',
  programId: 'program-1',
  enabled: true,
  sendContractAfterIntake: true,
  sendWelcomeAfterContractSigned: true,
  activeContractTemplateId: 'program-template-1',
  activeContractVersionId: 'program-version-1',
  activeWelcomeEmailTemplateId: null,
  activeWelcomeEmailVersionId: null,
  createdAt: now,
  updatedAt: now,
};
const programContractTemplate = {
  id: 'program-template-1',
  organizationId: 'org-1',
  programId: 'program-1',
  name: template.name,
  signatureRequired: true,
  isActive: true,
  createdAt: now,
  updatedAt: now,
};
const programContractVersion = {
  id: 'program-version-1',
  organizationId: 'org-1',
  templateId: 'program-template-1',
  version: 1,
  title: template.name,
  content: template.content,
  storedFileId: null,
  signableFields: [],
  createdBy: 'admin@example.com',
  createdAt: now,
};
const draftContract = {
  id: 'contract-1',
  organizationId: 'org-1',
  clientId: 'client-1',
  programId: 'program-1',
  contractTemplateId: 'template-1',
  contractType: template.name,
  generatedContent: 'Generated contract content.',
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
    getWelcomeAvailability: jest.fn().mockReturnValue('disabled'),
    sendContract: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'disabled' }),
    sendWelcome: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'disabled' }),
  };
}

// Shared test context: builds a real WorkflowConfigService against the same mocked `prisma`
// each test already configures, so every existing cfProgramWorkflowConfig mock/assertion keeps
// working unchanged - only the canonical service now sits between ContractsService and prisma.
function contractsServiceTestContext(
  prisma: unknown,
  n8n: unknown,
  overrides: { storage?: unknown } = {},
): ContractsService {
  const workflowConfig = new WorkflowConfigService(prisma as unknown as PrismaService);
  return new ContractsService(
    prisma as unknown as PrismaService,
    config(),
    n8n as unknown as N8nService,
    workflowConfig,
    (overrides.storage ?? { isEnabled: () => false }) as unknown as StorageService,
  );
}

describe('contract lifecycle rules', () => {
  it('classifies both auto-contract and all staff-review programs', () => {
    expect(Object.keys(PROGRAM_CONTRACT_RULES)).toHaveLength(9);
    expect(contractRuleFor('Brand Awareness Subscription')).toBe('auto_contract');
    expect(contractRuleFor('30-Day Premier Workshop Subscription')).toBe('auto_contract');
    expect(contractRuleFor('The Inspired Detroit Initiative')).toBe('auto_contract');
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

  it('derives standard monitoring due dates and safely falls back to seven days', () => {
    expect(monitoringDueDate(now, 'Weekly')).toEqual(new Date('2030-01-08T00:00:00.000Z'));
    expect(monitoringDueDate(now, 'Monthly')).toEqual(new Date('2030-01-31T00:00:00.000Z'));
    expect(monitoringDueDate(now, 'Custom')).toEqual(new Date('2030-01-08T00:00:00.000Z'));
  });

  it('uses the IDI-specific welcome message and falls back to the generic one otherwise', () => {
    expect(welcomeMessageFor('The Inspired Detroit Initiative')).toContain('Inspired Detroit Initiative');
    expect(welcomeMessageFor('Brand Awareness Subscription')).toBe(
      'Your onboarding has started. A team member will follow up with you soon.',
    );
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
      cfProgramWorkflowConfig: {
        findFirst: jest.fn().mockResolvedValue({ ...workflowConfig, sendContractAfterIntake: false }),
      },
      cfContract: { create: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    const result = await service.handlePostIntakeProgramSelection('org-1', 'client-1', 'program-1');

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
      cfContract: {
        update: jest.fn().mockResolvedValue(sentContract),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(sentContract),
      },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'skipped' }),
      },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      cfProgramContractTemplate: { findFirst: jest.fn().mockResolvedValue(programContractTemplate) },
      cfProgramContractVersion: { findFirst: jest.fn().mockResolvedValue(programContractVersion) },
      cfContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(draftContract),
      },
      cfCommunication: { update: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const n8n = n8nDisabled();
    const service = contractsServiceTestContext(prisma, n8n);

    const result = await service.handlePostIntakeProgramSelection('org-1', 'client-1', 'program-1');

    expect(prisma.cfContract.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'DRAFT',
        secureTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        generatedContent: expect.stringContaining('Template draft only.'),
      }),
    }));
    // Issued through the contract state machine: a conditional update from an issuable state.
    expect(transaction.cfContract.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: expect.any(String), status: { in: ['DRAFT', 'SENT', 'OPENED', 'EXPIRED'] } }),
      data: expect.objectContaining({
        status: 'SENT',
        secureTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
    expect(transaction.cfCommunication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'disabled' }),
    }));
    expect(n8n.sendContract).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextAction: 'CONTRACT_SENT',
      clientStatus: 'CONTRACT_SENT',
      emailDelivery: { status: 'failed', reason: 'disabled' },
    }));
    expect(JSON.stringify(result)).not.toContain('secureTokenHash');
  });

  it('stops intake automation and notifies staff when no active contract version is configured', async () => {
    const transaction = {
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'PENDING_STAFF_REVIEW' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfProgramWorkflowConfig: {
        findFirst: jest.fn().mockResolvedValue({
          ...workflowConfig,
          activeContractTemplateId: null,
          activeContractVersionId: null,
        }),
      },
      cfProgramContractTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      cfProgramContractVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      adminUser: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]) },
      cfNotification: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cfContract: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    const result = await service.handlePostIntakeProgramSelection('org-1', 'client-1', 'program-1');

    expect(prisma.cfContract.create).not.toHaveBeenCalled();
    expect(transaction.cfClient.update).toHaveBeenCalledWith({
      where: { id: 'client-1' },
      data: { status: 'PENDING_STAFF_REVIEW' },
    });
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'CONTRACT_CONFIGURATION_MISSING',
      }),
    }));
    expect(prisma.cfNotification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({
          type: 'CONTRACT_CONFIGURATION_MISSING',
          clientId: 'client-1',
          actionUrl: '/programs/program-1',
        }),
      ]),
      skipDuplicates: true,
    }));
    expect(result).toEqual(expect.objectContaining({
      nextAction: 'STAFF_REVIEW_REQUIRED',
      clientStatus: 'PENDING_STAFF_REVIEW',
      contract: null,
      emailDelivery: null,
      program: { id: 'program-1', name: autoProgram.name },
    }));
  });

  it('keeps the client in staff review when contract-config notifications fail', async () => {
    const transaction = {
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'PENDING_STAFF_REVIEW' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfProgramWorkflowConfig: {
        findFirst: jest.fn().mockResolvedValue({
          ...workflowConfig,
          activeContractTemplateId: null,
          activeContractVersionId: null,
        }),
      },
      cfProgramContractTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      cfProgramContractVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      adminUser: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]) },
      cfNotification: { createMany: jest.fn().mockRejectedValue(new Error('notification db unavailable')) },
      cfContract: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    const result = await service.handlePostIntakeProgramSelection('org-1', 'client-1', 'program-1');

    expect(transaction.cfClient.update).toHaveBeenCalledWith({
      where: { id: 'client-1' },
      data: { status: 'PENDING_STAFF_REVIEW' },
    });
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'CONTRACT_CONFIGURATION_MISSING' }),
    }));
    expect(result).toEqual(expect.objectContaining({
      nextAction: 'STAFF_REVIEW_REQUIRED',
      clientStatus: 'PENDING_STAFF_REVIEW',
      contract: null,
    }));
  });

  it('rejects automation contracts when no active program contract version is configured', async () => {
    const customProgram = {
      ...autoProgram,
      defaultContractTemplateId: 'custom-contract-template',
    };
    const transaction = {
      cfContract: {
        update: jest.fn().mockResolvedValue({ ...sentContract, contractTemplateId: 'template-mapped' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ ...sentContract, contractTemplateId: 'template-mapped' }),
      },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'skipped' }),
      },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(customProgram) },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue({ ...workflowConfig, activeContractTemplateId: null, activeContractVersionId: null }) },
      cfProgramContractTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      cfProgramContractVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      cfContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ ...draftContract, contractTemplateId: 'template-mapped' }),
      },
      cfCommunication: { update: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    await expect(service.issueContractForProgram('org-1', 'client-1', 'program-1', { enrollmentId: 'enroll-1' }))
      .rejects.toEqual(new BadRequestException('The selected program does not have an active contract template.'));
    expect(prisma.cfContract.create).not.toHaveBeenCalled();
  });

  it('generates a safe draft projection with a one-time URL', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      cfProgramContractTemplate: { findFirst: jest.fn().mockResolvedValue(programContractTemplate) },
      cfProgramContractVersion: { findFirst: jest.fn().mockResolvedValue(programContractVersion) },
      cfContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(draftContract),
      },
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    const result = await service.generateForStaff('org-1', 'client-1', { id: 'staff-1', name: 'Jordan Staff' });

    expect(result.publicContractUrl).toMatch(/^https:\/\/clientflow\.example\.com\/agreements\/[A-Za-z0-9_-]{43}$/);
    expect(result.contract).toEqual(expect.objectContaining({ id: 'contract-1', status: 'DRAFT' }));
    expect(JSON.stringify(result)).not.toContain('secureTokenHash');
  });

  it('stamps the staff signer and signature block onto a newly generated contract', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      cfProgramContractTemplate: { findFirst: jest.fn().mockResolvedValue(programContractTemplate) },
      cfProgramContractVersion: { findFirst: jest.fn().mockResolvedValue(programContractVersion) },
      cfContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(draftContract),
      },
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    await service.generateForStaff('org-1', 'client-1', { id: 'staff-1', name: 'Jordan Staff' });

    expect(prisma.cfContract.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        staffSignedByUserId: 'staff-1',
        staffSignedByName: 'Jordan Staff',
        staffSignedAt: expect.any(Date),
        generatedContent: expect.stringContaining('Signed by: Jordan Staff'),
      }),
    }));
  });

  it('returns a safe error when the default contract template is missing', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfProgramWorkflowConfig: {
        findFirst: jest.fn().mockResolvedValue({ ...workflowConfig, activeContractTemplateId: null, activeContractVersionId: null }),
      },
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    await expect(service.generateForStaff('org-1', 'client-1', { id: 'staff-1', name: 'Jordan Staff' })).rejects.toEqual(
      new BadRequestException('The selected program does not have an active contract template.'),
    );
  });

  it('sends an existing contract and records skipped delivery without exposing its hash', async () => {
    const transaction = {
      cfContract: {
        update: jest.fn().mockResolvedValue(sentContract),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(sentContract),
      },
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
      cfCommunication: { update: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    const result = await service.sendForStaff('org-1', 'client-1', 'contract-1');

    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: 'Contract sent' }),
    }));
    expect(result.emailDelivery).toEqual({ status: 'failed', reason: 'disabled' });
    expect(JSON.stringify(result)).not.toContain('secureTokenHash');
  });

  it('sends an already-generated contract from its own persisted data, never querying the legacy CfContractTemplate table', async () => {
    // Regression test: contractTemplateId is a CfProgramContractVersion id under the canonical
    // flow, not a legacy CfContractTemplate id - the prisma mock intentionally omits
    // cfContractTemplate entirely so any re-introduced lookup against it throws immediately.
    const canonicalContract = { ...draftContract, contractTemplateId: 'cfpcv_a1b2c3d4e5f6', contractType: 'IDI Membership Agreement' };
    const transaction = {
      cfContract: {
        update: jest.fn().mockResolvedValue({ ...canonicalContract, status: 'SENT' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ ...canonicalContract, status: 'SENT' }),
      },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'requested' }),
      },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfContract: { findFirst: jest.fn().mockResolvedValue(canonicalContract) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfCommunication: { update: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const n8n = {
      getContractAvailability: jest.fn().mockReturnValue('ready'),
      sendContract: jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2030-01-01T00:00:00.000Z' }),
    };
    const service = contractsServiceTestContext(prisma, n8n);

    const result = await service.sendForStaff('org-1', 'client-1', canonicalContract.id);

    expect(n8n.sendContract).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      contractName: 'IDI Membership Agreement',
    }));
    expect(result.contract).toEqual(expect.objectContaining({ status: 'SENT' }));
  });

  it('resends an already-SENT contract the same way, from its own persisted data', async () => {
    const canonicalSentContract = { ...sentContract, contractTemplateId: 'cfpcv_a1b2c3d4e5f6' };
    const transaction = {
      cfContract: {
        update: jest.fn().mockResolvedValue(canonicalSentContract),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(canonicalSentContract),
      },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'skipped' }),
      },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfContract: { findFirst: jest.fn().mockResolvedValue(canonicalSentContract) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfCommunication: { update: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    const result = await service.sendForStaff('org-1', 'client-1', canonicalSentContract.id);

    expect(result.emailDelivery).toEqual({ status: 'failed', reason: 'disabled' });
  });

  it('records an enabled accepted n8n delivery as sent', async () => {
    const transaction = {
      cfContract: {
        update: jest.fn().mockResolvedValue(sentContract),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(sentContract),
      },
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
    const service = contractsServiceTestContext(prisma, n8n);

    await service.sendForStaff('org-1', 'client-1', 'contract-1');

    expect(transaction.cfCommunication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REQUESTED', errorCode: null }),
    }));
    expect(prisma.cfCommunication.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'communication-1' },
      data: {
        status: 'SENT',
        sentAt: new Date('2030-01-01T00:00:00.000Z'),
        failedAt: null,
        errorCode: null,
      },
    });
  });

  it('transitions a linked interested enrollment to onboarding when its contract is sent', async () => {
    const linkedDraftContract = { ...draftContract, enrollmentId: 'enroll-1' };
    const transaction = {
      cfContract: {
        update: jest.fn().mockResolvedValue({ ...linkedDraftContract, status: 'SENT' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ ...linkedDraftContract, status: 'SENT' }),
      },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'skipped' }),
      },
      cfProgramEnrollment: {
        findFirst: jest.fn().mockResolvedValue({ status: 'interested' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cfEnrollmentStatusHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfContract: { findFirst: jest.fn().mockResolvedValue(linkedDraftContract) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      cfCommunication: { update: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    await service.sendForStaff('org-1', 'client-1', 'contract-1');

    expect(transaction.cfProgramEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: 'enroll-1', organizationId: 'org-1', status: 'interested' },
      data: { status: 'onboarding', lastProgressUpdate: expect.any(Date) },
    });
    expect(transaction.cfEnrollmentStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ previousStatus: 'interested', newStatus: 'onboarding' }),
    }));
  });

  it('does not touch the enrollment when a contract with no linked enrollment is sent', async () => {
    const transaction = {
      cfContract: {
        update: jest.fn().mockResolvedValue(sentContract),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(sentContract),
      },
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
      cfCommunication: { update: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    await expect(service.sendForStaff('org-1', 'client-1', 'contract-1')).resolves.toBeDefined();
  });

  it('opens a sent public contract once without exposing token or signer internals', async () => {
    const transaction = {
      cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_OPENED' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-opened' }) },
    };
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(autoProgram) },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    const result = await service.openPublicContract('a'.repeat(43));

    expect(transaction.cfContract.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'OPENED' },
    }));
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'CONTRACT_OPENED' }),
    }));
    expect(result.contract).toEqual(expect.objectContaining({
      status: 'OPENED',
      content: 'Generated contract content.',
    }));
    expect(JSON.stringify(result)).not.toMatch(/secureToken|signerIp|signedEmail/);
  });

  it('completes a public contract, starts onboarding, and creates the first monitoring task', async () => {
    const monitoringTask = {
      id: 'monitoring-1',
      type: 'Initial Follow-Up',
      status: 'PENDING',
      dueDate: new Date('2030-01-31T00:00:00.000Z'),
      assignedStaffId: null,
    };
    const transaction = {
      cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'ONBOARDING' }) },
      cfMonitoringTask: { create: jest.fn().mockResolvedValue(monitoringTask) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'welcome-communication', status: 'skipped' }),
      },
    };
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: {
        findFirst: jest.fn().mockResolvedValue({
          ...autoProgram,
          defaultMonitoringFrequency: 'Monthly',
        }),
      },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const n8n = n8nDisabled();
    const service = contractsServiceTestContext(prisma, n8n);

    const result = await service.completePublicContract('a'.repeat(43), {
      signedName: ' Client Owner ',
      signedEmail: 'CLIENT@EXAMPLE.COM',
      agreedToTerms: true,
    }, { signerIp: '127.0.0.1', userAgent: 'Contract Browser' });

    expect(transaction.cfContract.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'COMPLETED',
        signedName: 'Client Owner',
        signedEmail: 'client@example.com',
        agreedToTerms: true,
        secureTokenHash: null,
      }),
    }));
    expect(transaction.cfClient.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ONBOARDING' }),
    }));
    expect(transaction.cfMonitoringTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'Initial Follow-Up',
        status: 'PENDING',
        assignedStaffId: null,
      }),
    }));
    expect(n8n.sendWelcome).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      contract: expect.objectContaining({ status: 'COMPLETED' }),
      client: { id: 'client-1', status: 'ONBOARDING' },
      welcomeDelivery: { status: 'failed', reason: 'disabled' },
    }));
  });

  it('transitions a linked non-terminal enrollment to active when its contract is signed', async () => {
    const linkedSentContract = { ...sentContract, enrollmentId: 'enroll-1' };
    const transaction = {
      cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'ONBOARDING' }) },
      cfMonitoringTask: { create: jest.fn().mockResolvedValue({
        id: 'monitoring-1',
        type: 'Initial Follow-Up',
        status: 'PENDING',
        dueDate: new Date('2030-01-31T00:00:00.000Z'),
        assignedStaffId: null,
      }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'welcome-communication', status: 'skipped' }),
      },
      cfProgramEnrollment: {
        findFirst: jest.fn().mockResolvedValue({ status: 'onboarding' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cfEnrollmentStatusHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(linkedSentContract) },
      cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue({ status: 'onboarding', isArchived: false }) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: {
        findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }),
      },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    expect(transaction.cfProgramEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: 'enroll-1', organizationId: 'org-1', status: 'onboarding' },
      data: { status: 'active', lastProgressUpdate: expect.any(Date) },
    });
    expect(transaction.cfEnrollmentStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ previousStatus: 'onboarding', newStatus: 'active' }),
    }));
  });

  it('does not request or send a welcome email when the program workflow toggle is off, even though n8n is ready', async () => {
    const transaction = {
      cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'ONBOARDING' }) },
      cfMonitoringTask: { create: jest.fn().mockResolvedValue({
        id: 'monitoring-1',
        type: 'Initial Follow-Up',
        status: 'PENDING',
        dueDate: new Date('2030-01-31T00:00:00.000Z'),
        assignedStaffId: null,
      }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: { create: jest.fn() },
    };
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: {
        findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }),
      },
      cfProgramWorkflowConfig: {
        findFirst: jest.fn().mockResolvedValue({ ...workflowConfig, sendWelcomeAfterContractSigned: false }),
      },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const n8n = {
      getWelcomeAvailability: jest.fn().mockReturnValue('ready'),
      sendWelcome: jest.fn(),
    };
    const service = contractsServiceTestContext(prisma, n8n);

    const result = await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    expect(transaction.cfCommunication.create).not.toHaveBeenCalled();
    expect(n8n.sendWelcome).not.toHaveBeenCalled();
    expect(result.welcomeDelivery).toEqual({ status: 'skipped', reason: 'disabled' });
  });

  it('logs WELCOME_FAILED and notifies admins when an actual welcome send attempt fails', async () => {
    const transaction = {
      cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'ONBOARDING' }) },
      cfMonitoringTask: { create: jest.fn().mockResolvedValue({
        id: 'monitoring-1',
        type: 'Initial Follow-Up',
        status: 'PENDING',
        dueDate: new Date('2030-01-31T00:00:00.000Z'),
        assignedStaffId: null,
      }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: { create: jest.fn().mockResolvedValue({ id: 'welcome-communication', status: 'REQUESTED' }) },
    };
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: {
        findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }),
      },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      cfCommunication: { update: jest.fn().mockResolvedValue({}) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-failed' }) },
      adminUser: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]) },
      cfNotification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const n8n = {
      getWelcomeAvailability: jest.fn().mockReturnValue('ready'),
      sendWelcome: jest.fn().mockResolvedValue({ status: 'failed', reason: 'rejected' }),
    };
    const service = contractsServiceTestContext(prisma, n8n);

    const result = await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    expect(n8n.sendWelcome).toHaveBeenCalled();
    expect(prisma.cfCommunication.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'welcome-communication' },
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'rejected' }),
    }));
    expect(prisma.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'WELCOME_FAILED' }),
    }));
    expect(prisma.cfNotification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ type: 'WELCOME_FAILED', recipientAdminId: 'admin-1' }),
        expect.objectContaining({ type: 'WELCOME_FAILED', recipientAdminId: 'admin-2' }),
      ]),
    }));
    // Welcome failure must not undo the completed contract or onboarding transition.
    expect(result.contract.status).toBe('COMPLETED');
    expect(result.client.status).toBe('ONBOARDING');
  });

  function welcomeHeaderLogoTransaction() {
    return {
      cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'ONBOARDING' }) },
      cfMonitoringTask: { create: jest.fn().mockResolvedValue({
        id: 'monitoring-1',
        type: 'Initial Follow-Up',
        status: 'PENDING',
        dueDate: new Date('2030-01-31T00:00:00.000Z'),
        assignedStaffId: null,
      }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: { create: jest.fn().mockResolvedValue({ id: 'welcome-communication', status: 'REQUESTED' }) },
    };
  }

  // Reuses the WELCOME_FAILED-shaped n8n mock (status !== 'sent') so recordWelcomeDeliveryResult
  // takes its simple early-return path, keeping these payload-shape assertions independent of the
  // separate "sent" delivery transaction already covered above.
  function welcomeHeaderLogoN8n() {
    return {
      getWelcomeAvailability: jest.fn().mockReturnValue('ready'),
      sendWelcome: jest.fn().mockResolvedValue({ status: 'failed', reason: 'rejected' }),
    };
  }

  it('(A) includes headerImageUrl in the welcome.send payload when an organization logo is configured', async () => {
    const transaction = welcomeHeaderLogoTransaction();
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }) },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      organization: { findUnique: jest.fn().mockResolvedValue({ name: 'EA Management', settings: { logoStoredFileId: 'logo-file-1' } }) },
      cfStoredFile: { findFirst: jest.fn().mockResolvedValue({ storageKey: 'organization/header-logo/logo.png' }) },
      cfCommunication: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const storage = {
      isEnabled: jest.fn().mockReturnValue(true),
      getObjectPublicUrl: jest.fn().mockReturnValue('https://assets.example.com/organization/header-logo/logo.png'),
    };
    const n8n = welcomeHeaderLogoN8n();
    const service = contractsServiceTestContext(prisma, n8n, { storage });

    await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    expect(n8n.sendWelcome).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headerImageUrl: 'https://assets.example.com/organization/header-logo/logo.png',
    }));
  });

  it('(B) leaves headerImageUrl undefined and still sends the welcome email when no organization logo is configured', async () => {
    const transaction = welcomeHeaderLogoTransaction();
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }) },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      organization: { findUnique: jest.fn().mockResolvedValue({ name: 'EA Management', settings: {} }) },
      cfCommunication: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const storage = { isEnabled: jest.fn().mockReturnValue(true), getObjectPublicUrl: jest.fn() };
    const n8n = welcomeHeaderLogoN8n();
    const service = contractsServiceTestContext(prisma, n8n, { storage });

    await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    expect(storage.getObjectPublicUrl).not.toHaveBeenCalled();
    expect(n8n.sendWelcome).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headerImageUrl: undefined,
    }));
  });

  it('(C) resolves headerImageUrl to undefined without throwing when logo resolution fails, and welcome still sends', async () => {
    const transaction = welcomeHeaderLogoTransaction();
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }) },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      organization: { findUnique: jest.fn().mockResolvedValue({ name: 'EA Management', settings: { logoStoredFileId: 'logo-file-1' } }) },
      cfStoredFile: { findFirst: jest.fn().mockResolvedValue({ storageKey: 'organization/header-logo/logo.png' }) },
      cfCommunication: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const storage = {
      isEnabled: jest.fn().mockReturnValue(true),
      getObjectPublicUrl: jest.fn().mockImplementation(() => { throw new Error('R2_PUBLIC_URL not configured'); }),
    };
    const n8n = welcomeHeaderLogoN8n();
    const service = contractsServiceTestContext(prisma, n8n, { storage });

    const result = await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    expect(n8n.sendWelcome).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headerImageUrl: undefined,
    }));
    expect(result.client.status).toBe('ONBOARDING');
  });

  it('(D) keeps attachmentUrl behavior unchanged when a guide is configured and no logo is set', async () => {
    const transaction = welcomeHeaderLogoTransaction();
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }) },
      cfProgramWorkflowConfig: {
        findFirst: jest.fn().mockResolvedValue({
          ...workflowConfig,
          activeWelcomeEmailTemplateId: 'welcome-template-1',
          activeWelcomeEmailVersionId: 'welcome-version-1',
        }),
      },
      cfProgramWelcomeEmailTemplate: { findFirst: jest.fn().mockResolvedValue({ id: 'welcome-template-1' }) },
      cfProgramWelcomeEmailVersion: { findFirst: jest.fn().mockResolvedValue({
        id: 'welcome-version-1',
        templateId: 'welcome-template-1',
        subject: 'Welcome to {{program.name}}',
        body: 'Hello {{client.firstName}}',
        guideStoredFileId: 'guide-file-1',
      }) },
      organization: { findUnique: jest.fn().mockResolvedValue({ name: 'EA Management', settings: {} }) },
      cfStoredFile: { findFirst: jest.fn().mockResolvedValue({ storageKey: 'program-workflow/welcome-guides/guide.pdf' }) },
      cfCommunication: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const storage = {
      isEnabled: jest.fn().mockReturnValue(true),
      createPresignedDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://presigned.example.com/guide.pdf' }),
      getObjectPublicUrl: jest.fn(),
    };
    const n8n = welcomeHeaderLogoN8n();
    const service = contractsServiceTestContext(prisma, n8n, { storage });

    await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    expect(n8n.sendWelcome).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      attachmentUrl: 'https://presigned.example.com/guide.pdf',
      headerImageUrl: undefined,
    }));
    expect(storage.createPresignedDownloadUrl).toHaveBeenCalledWith('program-workflow/welcome-guides/guide.pdf', 900);
  });

  it('(E) includes both attachmentUrl and headerImageUrl when a guide and a logo are both configured', async () => {
    const transaction = welcomeHeaderLogoTransaction();
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }) },
      cfProgramWorkflowConfig: {
        findFirst: jest.fn().mockResolvedValue({
          ...workflowConfig,
          activeWelcomeEmailTemplateId: 'welcome-template-1',
          activeWelcomeEmailVersionId: 'welcome-version-1',
        }),
      },
      cfProgramWelcomeEmailTemplate: { findFirst: jest.fn().mockResolvedValue({ id: 'welcome-template-1' }) },
      cfProgramWelcomeEmailVersion: { findFirst: jest.fn().mockResolvedValue({
        id: 'welcome-version-1',
        templateId: 'welcome-template-1',
        subject: 'Welcome to {{program.name}}',
        body: 'Hello {{client.firstName}}',
        guideStoredFileId: 'guide-file-1',
      }) },
      organization: { findUnique: jest.fn().mockResolvedValue({ name: 'EA Management', settings: { logoStoredFileId: 'logo-file-1' } }) },
      cfStoredFile: { findFirst: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
        where.id === 'guide-file-1'
          ? { storageKey: 'program-workflow/welcome-guides/guide.pdf' }
          : where.id === 'logo-file-1'
            ? { storageKey: 'organization/header-logo/logo.png' }
            : null,
      )) },
      cfCommunication: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const storage = {
      isEnabled: jest.fn().mockReturnValue(true),
      createPresignedDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://presigned.example.com/guide.pdf' }),
      getObjectPublicUrl: jest.fn().mockReturnValue('https://assets.example.com/organization/header-logo/logo.png'),
    };
    const n8n = welcomeHeaderLogoN8n();
    const service = contractsServiceTestContext(prisma, n8n, { storage });

    await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    expect(n8n.sendWelcome).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      attachmentUrl: 'https://presigned.example.com/guide.pdf',
      headerImageUrl: 'https://assets.example.com/organization/header-logo/logo.png',
    }));
  });

  it('(G) leaves the contract.send payload unaffected by the header logo feature', async () => {
    const transaction = {
      cfContract: {
        update: jest.fn().mockResolvedValue(sentContract),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(sentContract),
      },
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
      cfCommunication: { update: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'sent' }) },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const n8n = {
      getContractAvailability: jest.fn().mockReturnValue('ready'),
      sendContract: jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2030-01-01T00:00:00.000Z' }),
    };
    const service = contractsServiceTestContext(prisma, n8n);

    await service.sendForStaff('org-1', 'client-1', 'contract-1');

    const [, contractPayload] = n8n.sendContract.mock.calls[0] as [string, Record<string, unknown>];
    expect(contractPayload).not.toHaveProperty('headerImageUrl');
    expect(contractPayload).not.toHaveProperty('attachmentUrl');
  });

  it('archives the fully executed contract to storage and files it on the client record', async () => {
    const monitoringTask = {
      id: 'monitoring-1',
      type: 'Initial Follow-Up',
      status: 'PENDING',
      dueDate: new Date('2030-01-31T00:00:00.000Z'),
      assignedStaffId: null,
    };
    const transaction = {
      cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'ONBOARDING' }) },
      cfMonitoringTask: { create: jest.fn().mockResolvedValue(monitoringTask) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'welcome-communication', status: 'skipped' }),
      },
    };
    const prisma = {
      cfStoredFile: { create: jest.fn().mockResolvedValue({ id: 'stored-file-1' }) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: {
        findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }),
      },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      cfContract: {
        findUnique: jest.fn().mockResolvedValue(sentContract),
        update: jest.fn().mockResolvedValue({ ...sentContract, executedStoredFileId: 'stored-file-1' }),
      },
      cfDocument: { create: jest.fn().mockResolvedValue({ id: 'document-1' }) },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const storage = {
      isEnabled: jest.fn().mockReturnValue(true),
      uploadBuffer: jest.fn().mockResolvedValue({
        bucket: 'eamanagement',
        objectKey: 'contracts/org-1/client-1/contract-1-executed.pdf',
        byteSize: 42,
        url: 'https://pub-account.r2.dev/contracts/org-1/client-1/contract-1-executed.pdf',
      }),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled(), { storage });

    await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    const [key, pdf, mimeType, fileName] = storage.uploadBuffer.mock.calls[0];
    expect(key).toBe('contracts/org-1/client-1/contract-1-executed.pdf');
    expect((pdf as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(mimeType).toBe('application/pdf');
    expect(fileName).toMatch(/ - Signed\.pdf$/);
    expect(prisma.cfStoredFile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        storageKey: 'contracts/org-1/client-1/contract-1-executed.pdf',
        mimeType: 'application/pdf',
        status: 'READY',
      }),
    }));
    expect(prisma.cfDocument.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1',
        clientId: 'client-1',
        type: 'contract',
        url: 'https://pub-account.r2.dev/contracts/org-1/client-1/contract-1-executed.pdf',
        storedFileId: 'stored-file-1',
        objectKey: 'contracts/org-1/client-1/contract-1-executed.pdf',
        bucket: 'eamanagement',
      }),
    }));
  });

  it('does not fail contract completion when storage archival throws', async () => {
    const monitoringTask = {
      id: 'monitoring-1',
      type: 'Initial Follow-Up',
      status: 'PENDING',
      dueDate: new Date('2030-01-31T00:00:00.000Z'),
      assignedStaffId: null,
    };
    const transaction = {
      cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'ONBOARDING' }) },
      cfMonitoringTask: { create: jest.fn().mockResolvedValue(monitoringTask) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'welcome-communication', status: 'skipped' }),
      },
    };
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: {
        findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }),
      },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      cfStoredFile: { create: jest.fn() },
      cfDocument: { create: jest.fn() },
      $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
        ? input(transaction)
        : Promise.all(input as Promise<unknown>[]))),
    };
    const storage = {
      isEnabled: jest.fn().mockReturnValue(true),
      uploadBuffer: jest.fn().mockRejectedValue(new Error('R2 unavailable')),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled(), { storage });

    const result = await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    expect(result.contract.status).toBe('COMPLETED');
    expect(prisma.cfDocument.create).not.toHaveBeenCalled();
  });

  it('rejects a repeated public completion before creating onboarding records', async () => {
    const transaction = {
      cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: {
        findFirst: jest.fn().mockResolvedValue({
          ...autoProgram,
          defaultMonitoringFrequency: 'Weekly',
        }),
      },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    await expect(service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('approves a pending-review client and issues a contract', async () => {
    const pendingClient = { ...client, status: 'PENDING_STAFF_REVIEW', programId: 'program-1' };
    const transaction = {
      cfContract: {
        update: jest.fn().mockResolvedValue(sentContract),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(sentContract),
      },
      cfClient: { update: jest.fn().mockResolvedValue({ ...pendingClient, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'skipped' }),
      },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(pendingClient) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(reviewProgram) },
      cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
      cfProgramContractTemplate: { findFirst: jest.fn().mockResolvedValue(programContractTemplate) },
      cfProgramContractVersion: { findFirst: jest.fn().mockResolvedValue({ ...programContractVersion, title: 'Grant Agreement', content: 'Grant agreement content.' }) },
      cfContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ ...draftContract, contractType: 'Grant Agreement' }),
      },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    const result = await service.approveReview('org-1', 'client-1', { id: 'staff-1', name: 'Jordan Staff' });

    expect(prisma.cfContract.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        staffSignedByUserId: 'staff-1',
        staffSignedByName: 'Jordan Staff',
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      nextAction: 'CONTRACT_SENT',
      clientStatus: 'CONTRACT_SENT',
      program: { id: 'program-1', name: 'Grant' },
    }));
  });

  it('rejects approval for a client that is not pending staff review', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_SENT' }) },
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    await expect(
      service.approveReview('org-1', 'client-1', { id: 'staff-1', name: 'Jordan Staff' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects approval when no staff signer name is provided', async () => {
    const service = contractsServiceTestContext({}, n8nDisabled());

    await expect(service.approveReview('org-1', 'client-1', { id: null, name: '  ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('declines a pending-review client without creating a contract', async () => {
    const pendingClient = { ...client, status: 'PENDING_STAFF_REVIEW' };
    const transaction = {
      cfClient: { update: jest.fn().mockResolvedValue({ ...pendingClient, status: 'REVIEW_DECLINED' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(pendingClient) },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = contractsServiceTestContext(prisma, n8nDisabled());

    const result = await service.declineReview('org-1', 'client-1', 'No longer eligible');

    expect(transaction.cfClient.update).toHaveBeenCalledWith({
      where: { id: 'client-1' },
      data: { status: 'REVIEW_DECLINED' },
    });
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: 'Staff review declined: No longer eligible' }),
    }));
    expect(result).toEqual({ client: { id: 'client-1', status: 'REVIEW_DECLINED' } });
  });
});
