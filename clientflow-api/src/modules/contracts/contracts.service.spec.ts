import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { StorageService } from '../../integrations/storage/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
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
      formId: expect.any(String),
      sentByUserId: expect.any(String),
      dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
    expect(result).toEqual(expect.objectContaining({
      nextAction: 'CONTRACT_SENT',
      clientStatus: 'CONTRACT_SENT',
      emailDelivery: { status: 'skipped', reason: 'disabled' },
    }));
    expect(JSON.stringify(result)).not.toContain('secureTokenHash');
  });

  it('issues automation contracts using program default template id first, then mapped fallback name', async () => {
    const customProgram = {
      ...autoProgram,
      defaultContractTemplateId: 'custom-contract-template',
    };
    const mappedTemplate = {
      ...template,
      id: 'template-mapped',
      name: 'Brand Awareness Service Agreement',
    };
    const transaction = {
      cfContract: { update: jest.fn().mockResolvedValue({ ...sentContract, contractTemplateId: 'template-mapped' }) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...client, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'skipped' }),
      },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(customProgram) },
      cfContractTemplate: { findMany: jest.fn().mockResolvedValue([mappedTemplate]) },
      cfContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ ...draftContract, contractTemplateId: 'template-mapped' }),
      },
      cfCommunication: { update: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    await service.issueContractForProgram('client-1', 'program-1', { enrollmentId: 'enroll-1' });

    expect(prisma.cfContractTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { id: 'custom-contract-template' },
          { name: { in: expect.arrayContaining(['custom-contract-template', 'Brand Awareness Service Agreement']) } },
        ]),
      }),
    }));
    expect(prisma.cfContract.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        enrollmentId: 'enroll-1',
        contractTemplateId: 'template-mapped',
      }),
    }));
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

    const result = await service.generateForStaff('client-1', { id: 'staff-1', name: 'Jordan Staff' });

    expect(result.publicContractUrl).toMatch(/^https:\/\/clientflow\.example\.com\/agreements\/[A-Za-z0-9_-]{43}$/);
    expect(result.contract).toEqual(expect.objectContaining({ id: 'contract-1', status: 'DRAFT' }));
    expect(JSON.stringify(result)).not.toContain('secureTokenHash');
  });

  it('stamps the staff signer and signature block onto a newly generated contract', async () => {
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

    await service.generateForStaff('client-1', { id: 'staff-1', name: 'Jordan Staff' });

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
      cfContractTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    await expect(service.generateForStaff('client-1', { id: 'staff-1', name: 'Jordan Staff' })).rejects.toEqual(
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
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

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
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const n8n = n8nDisabled();
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8n as unknown as N8nService,
    );

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
    expect(n8n.sendWelcome).toHaveBeenCalledWith('welcome.send:contract-1', {
      organizationId: 'org-1',
      clientId: 'client-1',
      formId: 'template-1',
      recipientEmail: 'client@example.com',
      clientName: 'Client Owner',
      programName: 'Brand Awareness Subscription',
      nextStep: 'Your onboarding has started. A team member will follow up with you soon.',
      sentByUserId: 'system',
    });
    expect(result).toEqual(expect.objectContaining({
      contract: expect.objectContaining({ status: 'COMPLETED' }),
      client: { id: 'client-1', status: 'ONBOARDING' },
      welcomeDelivery: { status: 'skipped', reason: 'disabled' },
    }));
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
      cfContract: { findUnique: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
      cfProgram: {
        findFirst: jest.fn().mockResolvedValue({ ...autoProgram, defaultMonitoringFrequency: 'Monthly' }),
      },
      cfDocument: { create: jest.fn().mockResolvedValue({ id: 'document-1' }) },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const storage = {
      isEnabled: jest.fn().mockReturnValue(true),
      uploadText: jest.fn().mockResolvedValue({
        bucket: 'eamanagement',
        objectKey: 'contracts/org-1/client-1/contract-1-executed.txt',
        byteSize: 42,
        url: 'https://pub-account.r2.dev/contracts/org-1/client-1/contract-1-executed.txt',
      }),
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
      storage as unknown as StorageService,
    );

    await service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null });

    expect(storage.uploadText).toHaveBeenCalledWith(
      'contracts/org-1/client-1/contract-1-executed.txt',
      expect.stringContaining('CLIENT ACCEPTANCE'),
      'text/plain',
    );
    expect(prisma.cfDocument.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1',
        clientId: 'client-1',
        type: 'contract',
        url: 'https://pub-account.r2.dev/contracts/org-1/client-1/contract-1-executed.txt',
        objectKey: 'contracts/org-1/client-1/contract-1-executed.txt',
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
      cfDocument: { create: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const storage = {
      isEnabled: jest.fn().mockReturnValue(true),
      uploadText: jest.fn().mockRejectedValue(new Error('R2 unavailable')),
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
      storage as unknown as StorageService,
    );

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
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    await expect(service.completePublicContract('a'.repeat(43), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, { signerIp: null, userAgent: null })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('approves a pending-review client and issues a contract', async () => {
    const pendingClient = { ...client, status: 'PENDING_STAFF_REVIEW', programId: 'program-1' };
    const transaction = {
      cfContract: { update: jest.fn().mockResolvedValue(sentContract) },
      cfClient: { update: jest.fn().mockResolvedValue({ ...pendingClient, status: 'CONTRACT_SENT' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'communication-1', status: 'skipped' }),
      },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(pendingClient) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue(reviewProgram) },
      cfContractTemplate: { findMany: jest.fn().mockResolvedValue([{ ...template, name: 'Grant Agreement' }]) },
      cfContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ ...draftContract, contractType: 'Grant Agreement' }),
      },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    const result = await service.approveReview('client-1', { id: 'staff-1', name: 'Jordan Staff' });

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
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    await expect(
      service.approveReview('client-1', { id: 'staff-1', name: 'Jordan Staff' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects approval when no staff signer name is provided', async () => {
    const service = new ContractsService(
      {} as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    await expect(service.approveReview('client-1', { id: null, name: '  ' })).rejects.toBeInstanceOf(
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
    const service = new ContractsService(
      prisma as unknown as PrismaService,
      config(),
      n8nDisabled() as unknown as N8nService,
    );

    const result = await service.declineReview('client-1', 'No longer eligible');

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
