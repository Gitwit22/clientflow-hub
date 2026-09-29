import { BadRequestException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { StorageService } from '../../integrations/storage/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { WorkflowConfigService } from '../programs/workflow-config.service';
import { ContractsService } from './contracts.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

const now = new Date('2030-01-01T00:00:00.000Z');
const staff = { id: 'admin-1', name: 'Jordan Lee' };
const client = {
  id: 'client-1',
  organizationId: 'org-1',
  programId: null,
  primaryContactName: 'Client Owner',
  email: 'client@example.com',
  assignedUserId: null,
  assignedStaff: 'Unassigned',
  isArchived: false,
  isDemo: false,
};
const program = {
  id: 'program-1',
  organizationId: 'org-1',
  name: 'Brand Awareness Subscription',
  defaultContractTemplateId: 'x',
  defaultMonitoringFrequency: 'Monthly',
  welcomeMessage: null,
  isActive: true,
};
const enrollment = { id: 'enroll-1', clientId: 'client-1', organizationId: 'org-1', programId: 'program-1' };
const workflowConfig = {
  id: 'workflow-1',
  organizationId: 'org-1',
  programId: 'program-1',
  enabled: true,
  sendContractAfterIntake: true,
  sendWelcomeAfterContractSigned: true,
  activeContractTemplateId: 'pt-1',
  activeContractVersionId: 'pv-1',
  activeWelcomeEmailTemplateId: null,
  activeWelcomeEmailVersionId: null,
  createdAt: now,
  updatedAt: now,
};
const contractBase = {
  id: 'contract-1',
  organizationId: 'org-1',
  clientId: 'client-1',
  programId: 'program-1',
  enrollmentId: 'enroll-1',
  contractTemplateId: 'template-1',
  contractType: 'Brand Awareness Service Agreement',
  generatedContent: 'Generated contract content.',
  secureTokenHash: 'a'.repeat(64),
  secureTokenExpiresAt: new Date('2030-01-08T00:00:00.000Z'),
  sentAt: null,
  completedAt: null,
  executedStoredFileId: null,
  createdAt: now,
  updatedAt: now,
};
const draft = { ...contractBase, status: 'DRAFT' };
const sent = { ...contractBase, status: 'SENT', sentAt: now };
const completed = {
  ...contractBase,
  status: 'COMPLETED',
  completedAt: now,
  executedStoredFileId: 'stored-1',
  secureTokenHash: null,
};

function config(): ConfigService<Environment, true> {
  const values: Record<string, string> = { APP_URL: 'https://clientflow.example.com' };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService<Environment, true>;
}

function build(prismaOverrides: Record<string, unknown>, n8n: Record<string, unknown>, storage?: unknown) {
  const transaction: Record<string, any> = {
    cfContract: { update: jest.fn().mockImplementation(async ({ data }) => ({ ...sent, ...data })) },
    cfClient: { update: jest.fn().mockResolvedValue(client) },
    cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
    cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    cfEnrollmentStatusHistory: { create: jest.fn() },
    cfCommunication: {
      create: jest.fn().mockImplementation(async ({ data }) => ({ ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma: Record<string, any> = {
    cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
    cfProgram: { findFirst: jest.fn().mockResolvedValue(program) },
    cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue(enrollment) },
    cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(workflowConfig) },
    cfProgramContractTemplate: {
      findFirst: jest.fn().mockResolvedValue({ id: 'pt-1', name: contractBase.contractType, signatureRequired: true }),
    },
    cfProgramContractVersion: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'pv-1', organizationId: 'org-1', title: contractBase.contractType, content: 'Template', createdAt: now,
      }),
    },
    cfContract: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(draft),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...draft, ...data })),
    },
    cfCommunication: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({ ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
    cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-2' }) },
    cfStoredFile: { findFirst: jest.fn().mockResolvedValue(executedPdf) },
    adminUser: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-9' }]) },
    cfNotification: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
      ? (input as (tx: unknown) => unknown)(transaction)
      : Promise.all(input as Promise<unknown>[]))),
    ...prismaOverrides,
  };
  const service = new ContractsService(
    prisma as unknown as PrismaService,
    config(),
    n8n as unknown as N8nService,
    new WorkflowConfigService(prisma as unknown as PrismaService),
    (storage ?? { isEnabled: () => false }) as unknown as StorageService,
  );
  return { service, prisma, transaction };
}

const readyN8n = (overrides: Record<string, unknown> = {}) => ({
  getContractAvailability: jest.fn().mockReturnValue('ready'),
  getWelcomeAvailability: jest.fn().mockReturnValue('ready'),
  getContractCopyAvailability: jest.fn().mockReturnValue('ready'),
  sendContract: jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2030-01-01T00:00:01.000Z' }),
  sendWelcome: jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2030-01-01T00:00:02.000Z' }),
  sendContractCopy: jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2030-01-01T00:00:03.000Z' }),
  ...overrides,
});

const executedPdf = {
  id: 'stored-pdf-1',
  storageKey: 'contracts/org-1/client-1/c-executed.pdf',
  mimeType: 'application/pdf',
  uploadedByUserId: null,
  completedAt: now,
};

const storageReady = () => ({
  isEnabled: jest.fn().mockReturnValue(true),
  createPresignedDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://r2.example.com/signed?sig=1' }),
});

describe('ContractsService: generate for an enrollment', () => {
  it('resolves the program from the enrollment (not the legacy client.programId) and stores the enrollment id', async () => {
    const { service, prisma } = build({}, readyN8n());
    await service.generateForStaff('org-1', 'client-1', staff, { enrollmentId: 'enroll-1' });

    expect(prisma.cfProgramEnrollment.findFirst).toHaveBeenCalledWith({
      where: { id: 'enroll-1', clientId: 'client-1', organizationId: 'org-1' },
    });
    expect(prisma.cfContract.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ programId: 'program-1', enrollmentId: 'enroll-1' }),
    }));
  });

  it("rejects another client's enrollment", async () => {
    const { service, prisma } = build({ cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue(null) } }, readyN8n());
    await expect(service.generateForStaff('org-1', 'client-1', staff, { enrollmentId: 'not-mine' })).rejects.toThrow(
      'Program enrollment not found for this client.',
    );
    expect(prisma.cfContract.create).not.toHaveBeenCalled();
  });

  it('reuses an existing DRAFT contract instead of creating a duplicate', async () => {
    const { service, prisma } = build({ cfContract: {
      findFirst: jest.fn().mockResolvedValue(draft),
      create: jest.fn(),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...draft, ...data })),
    } }, readyN8n());
    await service.generateForStaff('org-1', 'client-1', staff, { enrollmentId: 'enroll-1' });
    expect(prisma.cfContract.create).not.toHaveBeenCalled();
  });

  it('never rotates the signing link of a contract that was already emailed', async () => {
    const { service, prisma } = build({ cfContract: {
      findFirst: jest.fn().mockResolvedValue(sent),
      create: jest.fn(),
      update: jest.fn(),
    } }, readyN8n());

    const result = await service.generateForStaff('org-1', 'client-1', staff, { enrollmentId: 'enroll-1' });

    expect(prisma.cfContract.create).not.toHaveBeenCalled();
    expect(prisma.cfContract.update).not.toHaveBeenCalled(); // token untouched
    expect(result.publicContractUrl).toBeNull();
    expect(result.contract.id).toBe('contract-1');
  });
});

describe('ContractsService: manual contract send / resend', () => {
  const sendOptions = { enrollmentId: 'enroll-1', actor: staff, idempotencyKey: 'attempt-0001-abcd' };
  const draftLookup = () => ({ cfContract: {
    findFirst: jest.fn().mockResolvedValue(draft),
    create: jest.fn(),
    update: jest.fn(),
  } });

  it('records a manual send with the staff member, source, key, and a communication-based event id', async () => {
    const n8n = readyN8n();
    const { service, transaction } = build(draftLookup(), n8n);

    await service.sendForStaff('org-1', 'client-1', 'contract-1', sendOptions);

    const created = transaction.cfCommunication.create.mock.calls[0][0].data;
    expect(created).toEqual(expect.objectContaining({
      type: 'contract_email',
      source: 'manual_staff_action',
      idempotencyKey: 'attempt-0001-abcd',
      staffMember: 'Jordan Lee',
      createdByUserId: 'admin-1',
      enrollmentId: 'enroll-1',
    }));
    expect(created.eventId).toBe(`contract.send:contract-1:${created.id}`);
    expect(n8n.sendContract).toHaveBeenCalledWith(created.eventId, expect.any(Object));
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CONTRACT_SENT', user: 'Jordan Lee', actorUserId: 'admin-1', source: 'manual_staff_action',
      }),
    });
  });

  it('a retried request (same Idempotency-Key) neither re-issues the contract nor emails twice', async () => {
    const n8n = readyN8n();
    const prior = {
      id: 'comm-1', status: 'SENT', sentAt: new Date('2030-01-01T00:00:01.000Z'), errorCode: null,
      contractId: 'contract-1', formAssignmentId: null, type: 'contract_email',
    };
    const { service, prisma, transaction } = build(
      { ...draftLookup(), cfCommunication: { findFirst: jest.fn().mockResolvedValue(prior), create: jest.fn(), update: jest.fn() } },
      n8n,
    );

    const result = await service.sendForStaff('org-1', 'client-1', 'contract-1', sendOptions);

    expect(result).toEqual(expect.objectContaining({
      replayed: true,
      emailDelivery: { status: 'sent', sentAt: '2030-01-01T00:00:01.000Z' },
    }));
    expect(n8n.sendContract).not.toHaveBeenCalled();
    expect(transaction.cfContract.update).not.toHaveBeenCalled(); // token not rotated again
    expect(prisma.cfCommunication.create).not.toHaveBeenCalled();
  });

  it('a deliberate resend (new key) is a new attempt with its own event id', async () => {
    const n8n = readyN8n();
    const { service, transaction } = build(draftLookup(), n8n);
    await service.sendForStaff('org-1', 'client-1', 'contract-1', sendOptions);
    await service.sendForStaff('org-1', 'client-1', 'contract-1', { ...sendOptions, idempotencyKey: 'attempt-0002-abcd' });

    const ids = transaction.cfCommunication.create.mock.calls.map((call: any) => call[0].data.eventId);
    expect(new Set(ids).size).toBe(2);
    expect(n8n.sendContract).toHaveBeenCalledTimes(2);
  });

  it('rejects a contract that belongs to a different enrollment', async () => {
    const { service } = build(draftLookup(), readyN8n());
    await expect(
      service.sendForStaff('org-1', 'client-1', 'contract-1', { ...sendOptions, enrollmentId: 'other-enrollment' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resends a contract the client opened but has not signed, without creating a duplicate', async () => {
    const opened = { ...contractBase, status: 'OPENED', sentAt: now };
    const n8n = readyN8n();
    const { service, prisma } = build({ cfContract: { findFirst: jest.fn().mockResolvedValue(opened), create: jest.fn(), update: jest.fn() } }, n8n);

    await service.sendForStaff('org-1', 'client-1', 'contract-1', sendOptions);
    expect(n8n.sendContract).toHaveBeenCalledTimes(1);

    // Generating while an OPENED contract exists must not create a second contract or rotate its link.
    const generated = await service.generateForStaff('org-1', 'client-1', staff, { enrollmentId: 'enroll-1' });
    expect(prisma.cfContract.create).not.toHaveBeenCalled();
    expect(prisma.cfContract.update).not.toHaveBeenCalled();
    expect(generated.publicContractUrl).toBeNull();
  });

  it('refuses to push a signed contract back through the signing-link flow', async () => {
    const { service } = build({ cfContract: { findFirst: jest.fn().mockResolvedValue(completed) } }, readyN8n());
    await expect(service.sendForStaff('org-1', 'client-1', 'contract-1', sendOptions)).rejects.toThrow(
      'The contract cannot be sent in its current status.',
    );
  });

  it('automatic issuance keeps its existing hash-based event id and is tagged as automation', async () => {
    const n8n = readyN8n();
    const { service, transaction } = build({
      cfContract: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(draft), update: jest.fn() },
    }, n8n);
    await service.issueContractForProgram('org-1', 'client-1', 'program-1', { enrollmentId: 'enroll-1' });

    const created = transaction.cfCommunication.create.mock.calls[0][0].data;
    expect(created.eventId).toMatch(/^contract\.send:contract-1:[a-f0-9]{16}$/);
    expect(created.source).toBe('automation');
    expect(created.idempotencyKey).toBeNull();
  });
});

describe('ContractsService: send the signed copy', () => {
  const copyOptions = { actor: staff, idempotencyKey: 'copy-attempt-0001' };
  const completedLookup = (contract: Record<string, unknown> = completed) => ({ cfContract: {
    findFirst: jest.fn().mockResolvedValue(contract),
    update: jest.fn(),
    create: jest.fn(),
  } });

  it.each([['DRAFT', draft], ['SENT', sent]])('rejects a %s contract: only a signed contract has a copy', async (_name, contract) => {
    const { service, prisma } = build(completedLookup(contract), readyN8n(), storageReady());
    await expect(service.sendExecutedCopy('org-1', 'client-1', 'contract-1', copyOptions)).rejects.toThrow(
      'Only a signed contract can be sent as a copy.',
    );
    expect(prisma.cfCommunication.create).not.toHaveBeenCalled();
  });

  it('rejects a signed contract whose executed copy was never archived', async () => {
    const { service, prisma } = build(
      completedLookup({ ...completed, executedStoredFileId: null }), readyN8n(), storageReady(),
    );
    await expect(service.sendExecutedCopy('org-1', 'client-1', 'contract-1', copyOptions)).rejects.toThrow(
      'The signed copy is not available yet.',
    );
    expect(prisma.cfCommunication.create).not.toHaveBeenCalled();
  });

  it('sends contract.copy with a 7-day download link, without touching the signing token or status', async () => {
    const n8n = readyN8n();
    const storage = storageReady();
    const { service, prisma } = build(completedLookup(), n8n, storage);

    const result = await service.sendExecutedCopy('org-1', 'client-1', 'contract-1', copyOptions);

    expect(storage.createPresignedDownloadUrl).toHaveBeenCalledWith(
      'contracts/org-1/client-1/c-executed.pdf', 7 * 24 * 60 * 60,
      { downloadFileName: expect.stringMatching(/ - Signed\.pdf$/), contentType: 'application/pdf' },
    );
    const created = prisma.cfCommunication.create.mock.calls[0][0].data;
    expect(created).toEqual(expect.objectContaining({
      type: 'contract_copy_email',
      source: 'manual_staff_action',
      idempotencyKey: 'copy-attempt-0001',
      contractId: 'contract-1',
      staffMember: 'Jordan Lee',
    }));
    expect(created.eventId).toBe(`contract.copy:contract-1:${created.id}`);
    expect(n8n.sendContractCopy).toHaveBeenCalledWith(created.eventId, {
      organizationId: 'org-1',
      clientId: 'client-1',
      contractId: 'contract-1',
      enrollmentId: 'enroll-1',
      recipientEmail: 'client@example.com',
      clientName: 'Client Owner',
      executedCopyUrl: 'https://r2.example.com/signed?sig=1',
      programName: 'Brand Awareness Subscription',
      contractName: 'Brand Awareness Service Agreement',
      source: 'manual_staff_action',
      sentByUserId: 'admin-1',
    });
    expect(n8n.sendContract).not.toHaveBeenCalled(); // never the signing-link path
    expect(prisma.cfContract.update).not.toHaveBeenCalled(); // no token rotation, no status change
    expect(prisma.cfCommunication.update).toHaveBeenCalledWith({
      where: { id: created.id },
      data: expect.objectContaining({ status: 'SENT', errorCode: null }),
    });
    expect(prisma.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CONTRACT_COPY_SENT', user: 'Jordan Lee', source: 'manual_staff_action', enrollmentId: 'enroll-1',
      }),
    });
    expect(result.emailDelivery).toEqual({ status: 'sent', sentAt: '2030-01-01T00:00:03.000Z' });
  });

  it('upgrades a copy archived as plain text to a PDF before sending the link', async () => {
    const n8n = readyN8n();
    const storage = {
      ...storageReady(),
      uploadBuffer: jest.fn().mockResolvedValue({
        bucket: 'b', objectKey: 'contracts/org-1/client-1/contract-1-executed.pdf', byteSize: 2048, url: 'u',
      }),
    };
    const legacyText = { ...executedPdf, id: 'stored-txt-1', storageKey: 'contracts/org-1/client-1/c-executed.txt', mimeType: 'text/plain' };
    const { service, prisma } = build({
      ...completedLookup({ ...completed, signedName: 'Client Owner', signedEmail: 'client@example.com', signedAt: now }),
      cfStoredFile: {
        findFirst: jest.fn().mockResolvedValue(legacyText),
        upsert: jest.fn().mockResolvedValue({ id: 'stored-pdf-2' }),
      },
      cfDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    }, n8n, storage);

    await service.sendExecutedCopy('org-1', 'client-1', 'contract-1', copyOptions);

    const [key, pdf, mime] = storage.uploadBuffer.mock.calls[0];
    expect(key).toBe('contracts/org-1/client-1/contract-1-executed.pdf');
    expect((pdf as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(mime).toBe('application/pdf');
    expect(prisma.cfContract.update).toHaveBeenCalledWith({
      where: { id: 'contract-1' }, data: { executedStoredFileId: 'stored-pdf-2' },
    });
    expect(prisma.cfDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', storedFileId: 'stored-txt-1' },
    }));
    expect(storage.createPresignedDownloadUrl).toHaveBeenCalledWith(
      'contracts/org-1/client-1/contract-1-executed.pdf', 7 * 24 * 60 * 60, expect.anything(),
    );
    expect(n8n.sendContractCopy).toHaveBeenCalled();
  });

  it('records a failed delivery, logs CONTRACT_COPY_FAILED and notifies admins', async () => {
    const n8n = readyN8n({ sendContractCopy: jest.fn().mockResolvedValue({ status: 'failed', reason: 'rejected' }) });
    const { service, prisma } = build(completedLookup(), n8n, storageReady());

    const result = await service.sendExecutedCopy('org-1', 'client-1', 'contract-1', copyOptions);

    expect(result.emailDelivery).toEqual({ status: 'failed', reason: 'rejected' });
    expect(prisma.cfCommunication.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'rejected' }),
    }));
    expect(prisma.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CONTRACT_COPY_FAILED' }),
    });
    expect(prisma.cfNotification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ type: 'CONTRACT_COPY_FAILED' })]),
    }));
  });

  it('does not send when the referenced executed file no longer exists', async () => {
    const n8n = readyN8n();
    const storage = storageReady();
    const { service, prisma } = build({
      ...completedLookup(),
      cfStoredFile: { findFirst: jest.fn().mockResolvedValue(null) },
    }, n8n, storage);

    const result = await service.sendExecutedCopy('org-1', 'client-1', 'contract-1', copyOptions);

    expect(result.emailDelivery.status).toBe('failed');
    expect(n8n.sendContractCopy).not.toHaveBeenCalled();
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
    expect(prisma.cfCommunication.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'executed_copy_unavailable' }),
    }));
  });

  it('records a non-HTTPS executed-file URL as failed without sending it', async () => {
    const n8n = readyN8n();
    const storage = storageReady();
    storage.createPresignedDownloadUrl.mockResolvedValue({ url: 'http://storage.example.com/executed.txt' });
    const { service, prisma } = build(completedLookup(), n8n, storage);

    const result = await service.sendExecutedCopy('org-1', 'client-1', 'contract-1', copyOptions);

    expect(result.emailDelivery.status).toBe('failed');
    expect(n8n.sendContractCopy).not.toHaveBeenCalled();
    expect(prisma.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CONTRACT_COPY_FAILED' }),
    });
    expect(prisma.cfNotification.createMany).toHaveBeenCalled();
  });

  it('a retried request (same key) returns the first attempt and sends exactly once', async () => {
    const n8n = readyN8n();
    const prior = {
      id: 'comm-1', status: 'SENT', sentAt: new Date('2030-01-01T00:00:03.000Z'), errorCode: null,
      contractId: 'contract-1', formAssignmentId: null, type: 'contract_copy_email',
    };
    const { service, prisma } = build({
      ...completedLookup(),
      cfCommunication: { findFirst: jest.fn().mockResolvedValue(prior), create: jest.fn(), update: jest.fn() },
    }, n8n, storageReady());

    const result = await service.sendExecutedCopy('org-1', 'client-1', 'contract-1', copyOptions);

    expect(result.replayed).toBe(true);
    expect(n8n.sendContractCopy).not.toHaveBeenCalled();
    expect(prisma.cfCommunication.create).not.toHaveBeenCalled();
  });

  it('a new key is a new attempt with a different event id', async () => {
    const n8n = readyN8n();
    const { service, prisma } = build(completedLookup(), n8n, storageReady());
    await service.sendExecutedCopy('org-1', 'client-1', 'contract-1', copyOptions);
    await service.sendExecutedCopy('org-1', 'client-1', 'contract-1', { ...copyOptions, idempotencyKey: 'copy-attempt-0002' });
    const ids = prisma.cfCommunication.create.mock.calls.map((call: any) => call[0].data.eventId);
    expect(new Set(ids).size).toBe(2);
    expect(n8n.sendContractCopy).toHaveBeenCalledTimes(2);
    expect(n8n.sendContractCopy.mock.calls.map((call: any) => call[0])).toEqual(ids);
  });
});

describe('ContractsService: manual welcome email', () => {
  const welcomeOptions = { enrollmentId: 'enroll-1', actor: staff, idempotencyKey: 'welcome-attempt-01' };

  it('keeps the signature gate: refuses until the enrollment contract is COMPLETED', async () => {
    for (const contract of [null, draft, sent]) {
      const { service, prisma } = build({ cfContract: { findFirst: jest.fn().mockResolvedValue(contract) } }, readyN8n());
      await expect(service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions)).rejects.toThrow(
        'The contract must be signed before the welcome email can be sent.',
      );
      expect(prisma.cfCommunication.create).not.toHaveBeenCalled();
    }
  });

  it('sends the same welcome.send event the automatic path uses, recorded as a manual staff action', async () => {
    const n8n = readyN8n();
    const { service, prisma, transaction } = build(
      { cfContract: { findFirst: jest.fn().mockResolvedValue(completed) } }, n8n,
    );

    const result = await service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);

    const created = prisma.cfCommunication.create.mock.calls[0][0].data;
    expect(created).toEqual(expect.objectContaining({
      type: 'welcome_email',
      source: 'manual_staff_action',
      idempotencyKey: 'welcome-attempt-01',
      enrollmentId: 'enroll-1',
      staffMember: 'Jordan Lee',
    }));
    // The unique automatic id `welcome.send:<contractId>` is not reused, so a resend is possible.
    expect(created.eventId).toBe(`welcome.send:contract-1:${created.id}`);
    expect(n8n.sendWelcome).toHaveBeenCalledWith(created.eventId, expect.objectContaining({
      clientName: 'Client Owner',
      programName: 'Brand Awareness Subscription',
      recipientEmail: 'client@example.com',
    }));
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'WELCOME_SENT', user: 'Jordan Lee', actorUserId: 'admin-1', source: 'manual_staff_action',
      }),
    });
    expect(result.emailDelivery).toEqual({ status: 'sent', sentAt: '2030-01-01T00:00:02.000Z' });
  });

  it('records failures (activity + admin notification) and returns them instead of throwing', async () => {
    const n8n = readyN8n({ sendWelcome: jest.fn().mockResolvedValue({ status: 'failed', reason: 'timeout' }) });
    const { service, prisma } = build({ cfContract: { findFirst: jest.fn().mockResolvedValue(completed) } }, n8n);

    const result = await service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);

    expect(result.emailDelivery).toEqual({ status: 'failed', reason: 'timeout' });
    expect(prisma.cfCommunication.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'timeout' }),
    }));
    expect(prisma.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'WELCOME_FAILED', user: 'Jordan Lee', source: 'manual_staff_action' }),
    });
    expect(prisma.cfNotification.createMany).toHaveBeenCalled();
  });

  it('a retried request (same key) does not send a second welcome; a new key does', async () => {
    const n8n = readyN8n();
    const prior = {
      id: 'comm-1', status: 'SENT', sentAt: new Date('2030-01-01T00:00:02.000Z'), errorCode: null,
      contractId: 'contract-1', formAssignmentId: null, type: 'welcome_email',
    };
    const replay = build({
      cfContract: { findFirst: jest.fn().mockResolvedValue(completed) },
      cfCommunication: { findFirst: jest.fn().mockResolvedValue(prior), create: jest.fn(), update: jest.fn() },
    }, n8n);
    const replayed = await replay.service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);
    expect(replayed.replayed).toBe(true);
    expect(n8n.sendWelcome).not.toHaveBeenCalled();

    const fresh = build({ cfContract: { findFirst: jest.fn().mockResolvedValue(completed) } }, n8n);
    await fresh.service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);
    await fresh.service.sendWelcomeForEnrollment('org-1', 'client-1', { ...welcomeOptions, idempotencyKey: 'welcome-attempt-02' });
    const ids = fresh.prisma.cfCommunication.create.mock.calls.map((call: any) => call[0].data.eventId);
    expect(new Set(ids).size).toBe(2);
    expect(n8n.sendWelcome).toHaveBeenCalledTimes(2);
  });

  it("rejects another client's enrollment", async () => {
    const { service } = build({ cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue(null) } }, readyN8n());
    await expect(service.sendWelcomeForEnrollment('org-1', 'client-1', { ...welcomeOptions, enrollmentId: 'not-mine' }))
      .rejects.toThrow('Program enrollment not found for this client.');
  });
});

function completionContext(n8nOverrides: Record<string, unknown> = {}, prismaExtra: Record<string, unknown> = {}) {
  const order: string[] = [];
  const n8n = readyN8n({
    sendContractCopy: jest.fn(async () => {
      order.push('copy');
      return { status: 'sent', sentAt: '2030-01-01T00:00:03.000Z' };
    }),
    sendWelcome: jest.fn(async () => {
      order.push('welcome');
      return { status: 'sent', sentAt: '2030-01-01T00:00:02.000Z' };
    }),
    ...n8nOverrides,
  });
  const transaction: Record<string, any> = {
    cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    cfClient: { update: jest.fn().mockResolvedValue(client) },
    cfMonitoringTask: { create: jest.fn().mockResolvedValue({ id: 'm-1', type: 'x', status: 'PENDING', dueDate: now, assignedStaffId: null }) },
    cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'a-1' }) },
    cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue(null) },
    cfCommunication: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'welcome-comm', ...data })), update: jest.fn() },
  };
  const storage = {
    ...storageReady(),
    uploadBuffer: jest.fn().mockResolvedValue({ bucket: 'b', objectKey: 'k', byteSize: 1, url: 'u' }),
  };
  const { service, prisma } = build({
    cfContract: {
      findUnique: jest.fn().mockResolvedValue(sent),
      findFirst: jest.fn().mockResolvedValue(completed),
      update: jest.fn(),
    },
    cfStoredFile: {
      create: jest.fn().mockResolvedValue({ id: 'stored-1' }),
      findFirst: jest.fn().mockResolvedValue({ ...executedPdf, storageKey: 'k' }),
    },
    cfDocument: { create: jest.fn() },
    $transaction: jest.fn(async (input: unknown) => (typeof input === 'function'
      ? (input as (tx: unknown) => unknown)(transaction)
      : Promise.all(input as Promise<unknown>[]))),
    ...prismaExtra,
  }, n8n, storage);
  const complete = () => service.completePublicContract('a'.repeat(43), {
    signedName: 'Client Owner', signedEmail: 'client@example.com', agreedToTerms: true,
  }, { signerIp: null, userAgent: null });
  return { complete, order, n8n, prisma, transaction };
}


describe('ContractsService: completion sends the signed copy, then the welcome email', () => {
  it('fires contract.copy first (automation) and then welcome.send', async () => {
    const { complete, order, n8n, prisma, transaction } = completionContext({}, {
      cfClient: { findFirst: jest.fn().mockResolvedValue({ ...client, assignedUserId: 'assigned-staff-1' }) },
    });
    await complete();

    expect(order).toEqual(['copy', 'welcome']);
    expect(n8n.sendContractCopy).toHaveBeenCalledWith(expect.stringMatching(/^contract\.copy:contract-1:/),
      expect.objectContaining({ source: 'automation', sentByUserId: 'system' }));
    const copyComm = prisma.cfCommunication.create.mock.calls[0][0].data;
    expect(copyComm).toEqual(expect.objectContaining({
      type: 'contract_copy_email',
      source: 'automation',
      idempotencyKey: 'auto:contract.copy:contract-1',
      staffMember: 'system',
    }));
    const welcomeComm = transaction.cfCommunication.create.mock.calls[0][0].data;
    expect(welcomeComm).toEqual(expect.objectContaining({
      type: 'welcome_email',
      source: 'automation',
      idempotencyKey: 'auto:welcome.send:contract-1',
      eventId: 'welcome.send:contract-1',
    }));
  });

  it('a failing signed copy never blocks the welcome email or the completion', async () => {
    const { complete, order, n8n, prisma } = completionContext({
      sendContractCopy: jest.fn().mockResolvedValue({ status: 'failed', reason: 'rejected' }),
    });
    const result = await complete();

    expect(n8n.sendContractCopy).toHaveBeenCalled();
    expect(order).toEqual(['welcome']);
    expect(result.contract.status).toBe('COMPLETED');
    expect(result.welcomeDelivery).toEqual({ status: 'sent', sentAt: '2030-01-01T00:00:02.000Z' });
    expect(prisma.cfCommunication.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'rejected' }),
    }));
    expect(prisma.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CONTRACT_COPY_FAILED', source: 'automation' }),
    });
    expect(prisma.cfNotification.createMany).toHaveBeenCalled();
  });

  it('reuses the recorded automatic attempt without allocating another eventId', async () => {
    const prior = {
      id: 'copy-attempt-1', eventId: 'contract.copy:contract-1:copy-attempt-1',
      status: 'SENT', sentAt: now, errorCode: null,
      contractId: 'contract-1', formAssignmentId: null, type: 'contract_copy_email',
    };
    const { complete, order, n8n, prisma } = completionContext({}, {
      cfCommunication: { findFirst: jest.fn().mockResolvedValue(prior), create: jest.fn(), update: jest.fn() },
    });

    const result = await complete();

    expect(prisma.cfCommunication.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', idempotencyKey: 'auto:contract.copy:contract-1' },
    });
    expect(prisma.cfCommunication.create).not.toHaveBeenCalled();
    expect(n8n.sendContractCopy).not.toHaveBeenCalled();
    expect(order).toEqual(['welcome']);
    expect(result.contract.status).toBe('COMPLETED');
  });

  it('a throwing signed-copy path is swallowed: welcome still sends and the contract stays completed', async () => {
    const { complete, order } = completionContext({
      sendContractCopy: jest.fn().mockRejectedValue(new Error('n8n exploded')),
    });
    const result = await complete();

    expect(order).toEqual(['welcome']);
    expect(result.contract.status).toBe('COMPLETED');
  });
});

describe('ContractsService: ClientFlow owns the welcome wording', () => {
  const welcomeOptions = { enrollmentId: 'enroll-1', actor: staff, idempotencyKey: 'welcome-attempt-01' };
  const john = { ...client, primaryContactName: 'John Steele' };
  const versionBody =
    'Good Afternoon {{client.firstName}}:\n\nYour membership payment has been received.\n\nEAM-Team "Inspire to be Great"';
  const expectedBody =
    'Good Afternoon John:\n\nYour membership payment has been received.\n\nEAM-Team "Inspire to be Great"';
  const activeWorkflow = {
    ...workflowConfig,
    activeWelcomeEmailTemplateId: 'wt-1',
    activeWelcomeEmailVersionId: 'wv-3',
  };
  const activeVersionModels = () => ({
    cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(activeWorkflow) },
    cfProgramWelcomeEmailVersion: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'wv-3',
        templateId: 'wt-1',
        version: 3,
        subject: 'Welcome to {{program.name}}',
        body: versionBody,
        guideStoredFileId: null,
      }),
    },
    cfProgramWelcomeEmailTemplate: {
      findFirst: jest.fn().mockResolvedValue({ id: 'wt-1', name: 'IDI Membership Welcome' }),
    },
  });
  const sentPayload = (n8n: { sendWelcome: jest.Mock }) => n8n.sendWelcome.mock.calls[0][1];
  const withContract = () => ({
    cfContract: { findFirst: jest.fn().mockResolvedValue(completed) },
    cfClient: { findFirst: jest.fn().mockResolvedValue(john) },
  });

  it('sends the active program version as the subject and body, exactly as configured, plus the version id', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const n8n = readyN8n();
    const { service, prisma } = build({ ...withContract(), ...activeVersionModels() }, n8n);

    await service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);

    const payload = sentPayload(n8n);
    expect(payload.subject).toBe('Welcome to Brand Awareness Subscription');
    // Variables are resolved; nothing is added before or after the configured wording.
    expect(payload.body).toBe(expectedBody);
    expect(payload.body).not.toMatch(/Welcome, John|Thank you for completing|Your next step|We are glad/);
    expect(payload.nextStep).toBe(payload.body); // legacy field carries the same text
    expect(payload.renderMode).toBe('verbatim');
    expect(payload.welcome).toEqual({
      source: 'program_version',
      templateId: 'wt-1',
      templateName: 'IDI Membership Welcome',
      versionId: 'wv-3',
      versionNumber: 3,
    });

    // The same trace is stored with the communication and written to the log (no client data).
    const stored = prisma.cfCommunication.create.mock.calls[0][0].data;
    expect(stored.renderedBody).toBe(payload.body);
    expect(stored.renderedSubject).toBe(payload.subject);
    expect(stored.templateContext.welcome).toEqual(payload.welcome);
    const line = log.mock.calls.map((call) => String(call[0])).find((message) => message.startsWith('welcome.send'));
    expect(line).toContain('versionId=wv-3');
    expect(line).toContain('templateId=wt-1');
    expect(line).toContain('source=program_version');
    expect(line).not.toContain('John');
    log.mockRestore();
  });

  it('with no active version, uses the program welcome message override', async () => {
    const n8n = readyN8n();
    const { service } = build({
      ...withContract(),
      cfProgram: { findFirst: jest.fn().mockResolvedValue({ ...program, welcomeMessage: 'Hi {{client.firstName}}, welcome aboard.' }) },
    }, n8n);

    await service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);

    const payload = sentPayload(n8n);
    expect(payload.body).toBe('Hi John, welcome aboard.');
    expect(payload.subject).toBe('Welcome to Brand Awareness Subscription');
    expect(payload.welcome).toEqual({
      source: 'program_message', templateId: null, templateName: null, versionId: null, versionNumber: null,
    });
  });

  it('with neither an active version nor an override, uses the generic ClientFlow body', async () => {
    const n8n = readyN8n();
    const { service } = build(withContract(), n8n);

    await service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);

    const payload = sentPayload(n8n);
    expect(payload.body).toBe('Your onboarding has started. A team member will follow up with you soon.');
    expect(payload.welcome).toEqual({
      source: 'default', templateId: null, templateName: null, versionId: null, versionNumber: null,
    });
  });

  describe('welcome guide attachment', () => {
    const withGuide = (storedFile: Record<string, unknown> | null) => {
      const models = activeVersionModels();
      models.cfProgramWelcomeEmailVersion.findFirst = jest.fn().mockResolvedValue({
        id: 'wv-3', templateId: 'wt-1', version: 3, subject: 'Welcome', body: 'Hello', guideStoredFileId: 'guide-1',
      });
      return { ...withContract(), ...models, cfStoredFile: { findFirst: jest.fn().mockResolvedValue(storedFile) } };
    };

    it("sends the guide's real filename and type with the download URL, not just a presigned URL", async () => {
      const n8n = readyN8n();
      const storage = storageReady();
      const { service, prisma } = build(
        withGuide({ storageKey: 'program-workflow/welcome-guides/8f3a.pdf', originalFileName: 'IDI Member Welcome Guide.pdf', mimeType: 'application/pdf' }),
        n8n,
        storage,
      );

      await service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);

      expect(prisma.cfStoredFile.findFirst).toHaveBeenCalledWith({
        where: { id: 'guide-1', organizationId: 'org-1' },
        select: { storageKey: true, originalFileName: true, mimeType: true },
      });
      expect(storage.createPresignedDownloadUrl).toHaveBeenCalledWith('program-workflow/welcome-guides/8f3a.pdf', 900);
      const payload = sentPayload(n8n);
      expect(payload.attachmentUrl).toBe('https://r2.example.com/signed?sig=1');
      expect(payload.attachmentFileName).toBe('IDI Member Welcome Guide.pdf');
      expect(payload.attachmentMimeType).toBe('application/pdf');
    });

    it('cleans a staff-supplied filename so it cannot smuggle a path into the attachment name', async () => {
      const n8n = readyN8n();
      const { service } = build(
        withGuide({ storageKey: 'k', originalFileName: '../../etc/passwd\\evil.pdf', mimeType: 'application/pdf' }),
        n8n,
        storageReady(),
      );

      await service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);

      const { attachmentFileName } = sentPayload(n8n);
      expect(attachmentFileName).toBe('.._.._etc_passwd_evil.pdf');
      expect(attachmentFileName).not.toMatch(/[\\/]/);
    });

    it('omits a filename or type that is empty, and the whole attachment when there is no guide', async () => {
      const blank = readyN8n();
      await build(withGuide({ storageKey: 'k', originalFileName: '  ', mimeType: '' }), blank, storageReady())
        .service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);
      const payload = sentPayload(blank);
      expect(payload.attachmentUrl).toBe('https://r2.example.com/signed?sig=1');
      expect(payload).toHaveProperty('attachmentFileName', undefined);
      expect(payload).toHaveProperty('attachmentMimeType', undefined);

      const none = readyN8n();
      await build(withContract(), none, storageReady()).service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);
      expect(sentPayload(none).attachmentUrl).toBeUndefined();
      expect(sentPayload(none).attachmentFileName).toBeUndefined();
      expect(sentPayload(none).attachmentMimeType).toBeUndefined();
    });

    it('sends no attachment when the guide file no longer exists', async () => {
      const n8n = readyN8n();
      await build(withGuide(null), n8n, storageReady()).service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);
      expect(sentPayload(n8n).attachmentUrl).toBeUndefined();
      expect(sentPayload(n8n).attachmentFileName).toBeUndefined();
    });
  });

  it('does not use a version that belongs to a different template than the active one', async () => {
    const n8n = readyN8n();
    const { service } = build({
      ...withContract(),
      ...activeVersionModels(),
      cfProgramWelcomeEmailVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'wv-x', templateId: 'some-other-template', version: 1, subject: 'Other', body: 'Other body', guideStoredFileId: null,
        }),
      },
    }, n8n);

    await service.sendWelcomeForEnrollment('org-1', 'client-1', welcomeOptions);

    const payload = sentPayload(n8n);
    expect(payload.body).not.toBe('Other body');
    expect(payload.welcome.source).toBe('default');
    expect(payload.welcome.versionId).toBeNull();
  });

  it('the automatic post-signature email uses the same resolved copy and the same trace', async () => {
    const { complete, n8n, transaction } = completionContext({}, {
      ...activeVersionModels(),
      cfClient: { findFirst: jest.fn().mockResolvedValue(john) },
    });

    await complete();

    const payload = (n8n.sendWelcome).mock.calls[0][1];
    expect(payload.subject).toBe('Welcome to Brand Awareness Subscription');
    expect(payload.body).toBe(expectedBody);
    expect(payload.renderMode).toBe('verbatim');
    expect(payload.welcome).toEqual(expect.objectContaining({ source: 'program_version', versionId: 'wv-3' }));
    expect(transaction.cfCommunication.create.mock.calls[0][0].data.templateContext.welcome.versionId).toBe('wv-3');
  });
});
