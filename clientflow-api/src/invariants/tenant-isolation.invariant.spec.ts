import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  findClientForOrg,
  findContractForOrg,
  findEnrollmentForOrg,
  findFormAssignmentForOrg,
  findProgramForOrg,
} from '../common/tenancy/org-scoped.repository';
import type { Environment } from '../config/env';
import type { N8nService } from '../integrations/n8n/n8n.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../modules/clients/clients.service';
import { ContractsService } from '../modules/contracts/contracts.service';
import { WorkflowConfigService } from '../modules/programs/workflow-config.service';
import { inMemoryDb } from './in-memory-db';

/**
 * INVARIANT 1: a client in Org A can never be read or written by an Org B admin.
 * Every entry point is driven with Org B's organization and Org A's ids, against a database that
 * really filters, so any lookup that forgets the organization leaks and this spec fails.
 */
const ORG_A = 'org-a';
const ORG_B = 'org-b';

function seed() {
  return inMemoryDb({
    organization: [{ id: ORG_A, status: 'active' }, { id: ORG_B, status: 'active' }],
    cfClient: [{
      id: 'client-a', organizationId: ORG_A, isArchived: false, status: 'PENDING_STAFF_REVIEW',
      programId: 'program-a', primaryContactName: 'A Owner', businessName: 'A LLC', email: 'a@example.com',
      assignedStaff: 'Unassigned', assignedUserId: null, isDemo: false,
    }],
    cfProgram: [{ id: 'program-a', organizationId: ORG_A, name: 'A Program', isActive: true }],
    cfProgramEnrollment: [{ id: 'enroll-a', organizationId: ORG_A, clientId: 'client-a', programId: 'program-a', status: 'active' }],
    cfContract: [{
      id: 'contract-a', organizationId: ORG_A, clientId: 'client-a', programId: 'program-a',
      enrollmentId: 'enroll-a', status: 'COMPLETED', executedStoredFileId: 'file-a',
    }],
    cfFormAssignment: [{ id: 'assign-a', organizationId: ORG_A, clientId: 'client-a', formId: 'form-a' }],
  });
}

function services() {
  const db = seed() as unknown as PrismaService;
  const config = { get: jest.fn(() => 'https://clientflow.example.com') } as unknown as ConfigService<Environment, true>;
  const n8n = {
    getIntakeAvailability: () => 'ready',
    getContractAvailability: () => 'ready',
    getContractCopyAvailability: () => 'ready',
    getWelcomeAvailability: () => 'ready',
  } as unknown as N8nService;
  const contracts = new ContractsService(db, config, n8n, new WorkflowConfigService(db));
  const clients = new ClientsService(db, config, n8n, contracts);
  return { db, contracts, clients };
}

describe('INVARIANT: Org B can never read or write an Org A client', () => {
  const signer = { id: 'admin-b', name: 'Org B Admin' };

  it('every tenancy lookup refuses Org A ids for Org B (404, same as nonexistent)', async () => {
    const { db } = services();
    await expect(findClientForOrg(db, ORG_B, 'client-a', { includeArchived: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(findProgramForOrg(db, ORG_B, 'program-a')).rejects.toBeInstanceOf(NotFoundException);
    await expect(findEnrollmentForOrg(db, ORG_B, 'enroll-a')).rejects.toBeInstanceOf(NotFoundException);
    await expect(findContractForOrg(db, ORG_B, 'contract-a')).rejects.toBeInstanceOf(NotFoundException);
    await expect(findFormAssignmentForOrg(db, ORG_B, 'assign-a')).rejects.toBeInstanceOf(NotFoundException);
    // Control: the owner can.
    await expect(findClientForOrg(db, ORG_A, 'client-a')).resolves.toEqual(expect.objectContaining({ id: 'client-a' }));
  });

  it.each([
    ['read the client', (s: ReturnType<typeof services>) => s.clients.getOne(ORG_B, 'client-a')],
    ['change its program', (s: ReturnType<typeof services>) => s.clients.updateProgram(ORG_B, 'client-a', 'program-a')],
    ['resend its intake', (s: ReturnType<typeof services>) => s.clients.sendIntakeNow(ORG_B, 'client-a')],
    ['generate a contract', (s: ReturnType<typeof services>) => s.contracts.generateForStaff(ORG_B, 'client-a', signer)],
    ['send a contract', (s: ReturnType<typeof services>) => s.contracts.sendForStaff(ORG_B, 'client-a', 'contract-a')],
    ['send the signed copy', (s: ReturnType<typeof services>) => s.contracts.sendExecutedCopy(ORG_B, 'client-a', 'contract-a')],
    ['send the welcome email', (s: ReturnType<typeof services>) => s.contracts.sendWelcomeForEnrollment(ORG_B, 'client-a', { enrollmentId: 'enroll-a' })],
    ['approve its review', (s: ReturnType<typeof services>) => s.contracts.approveReview(ORG_B, 'client-a', signer)],
    ['decline its review', (s: ReturnType<typeof services>) => s.contracts.declineReview(ORG_B, 'client-a')],
    ['issue a contract via automation', (s: ReturnType<typeof services>) => s.contracts.issueContractForProgram(ORG_B, 'client-a', 'program-a')],
  ])('Org B cannot %s', async (_action, act) => {
    const s = services();
    const before = JSON.stringify(await (s.db as unknown as { cfClient: { findMany: () => Promise<unknown> } }).cfClient.findMany());
    await expect(act(s)).rejects.toBeInstanceOf(NotFoundException);
    const after = JSON.stringify(await (s.db as unknown as { cfClient: { findMany: () => Promise<unknown> } }).cfClient.findMany());
    expect(after).toBe(before);
  });
});
