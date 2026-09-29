import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env';
import type { N8nService } from '../integrations/n8n/n8n.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ContractsService } from '../modules/contracts/contracts.service';
import { WorkflowConfigService } from '../modules/programs/workflow-config.service';
import { inMemoryDb } from './in-memory-db';

/**
 * INVARIANT 5: every client/program relationship used for a workflow decision comes from the
 * enrollment. The legacy client.programId alone never yields a contract, and when the two
 * disagree the enrollment wins.
 */
const ORG = 'org-a';
const signer = { id: 'admin-a', name: 'Org A Admin' };

function programRows(id: string) {
  return {
    program: { id, organizationId: ORG, name: `Program ${id}`, isActive: true, defaultContractTemplateId: '' },
    workflow: {
      id: `wf-${id}`, organizationId: ORG, programId: id, enabled: true, sendContractAfterIntake: true,
      sendWelcomeAfterContractSigned: true, activeContractTemplateId: `pt-${id}`, activeContractVersionId: `pv-${id}`,
    },
    template: { id: `pt-${id}`, organizationId: ORG, programId: id, name: `Agreement ${id}`, signatureRequired: true, isActive: true },
    version: { id: `pv-${id}`, organizationId: ORG, templateId: `pt-${id}`, version: 1, title: `Agreement ${id}`, content: 'Terms.' },
  };
}

function setup(enrollments: Array<Record<string, unknown>>) {
  const legacy = programRows('program-legacy');
  const enrolled = programRows('program-enrolled');
  const rows = {
    cfClient: [{
      id: 'client-a', organizationId: ORG, isArchived: false, status: 'PENDING_STAFF_REVIEW',
      programId: 'program-legacy', primaryContactName: 'A Owner', businessName: 'A LLC', email: 'a@example.com',
      assignedStaff: 'Unassigned', assignedUserId: null, isDemo: false,
    }],
    cfProgram: [legacy.program, enrolled.program],
    cfProgramWorkflowConfig: [legacy.workflow, enrolled.workflow],
    cfProgramContractTemplate: [legacy.template, enrolled.template],
    cfProgramContractVersion: [legacy.version, enrolled.version],
    cfProgramEnrollment: enrollments,
    cfContract: [] as Array<Record<string, unknown>>,
  };
  const db = inMemoryDb(rows) as unknown as PrismaService;
  const service = new ContractsService(
    db,
    { get: () => 'https://clientflow.example.com' } as unknown as ConfigService<Environment, true>,
    { getContractAvailability: () => 'disabled', getWelcomeAvailability: () => 'disabled' } as unknown as N8nService,
    new WorkflowConfigService(db),
  );
  return { rows, service };
}

describe('INVARIANT: workflow decisions come from the enrollment, never client.programId', () => {
  it.each([
    ['generate a contract', (s: ContractsService) => s.generateForStaff(ORG, 'client-a', signer)],
    ['approve the review', (s: ContractsService) => s.approveReview(ORG, 'client-a', signer)],
    ['issue the program contract', (s: ContractsService) => s.issueContractForProgram(ORG, 'client-a', 'program-legacy')],
  ])('a client with programId but no enrollment cannot %s', async (_label, act) => {
    const { rows, service } = setup([]);
    await expect(act(service)).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.cfContract).toHaveLength(0);
  });

  it('when client.programId and the enrollment disagree, the contract follows the enrollment', async () => {
    const { rows, service } = setup([{
      id: 'enroll-a', organizationId: ORG, clientId: 'client-a', programId: 'program-enrolled',
      status: 'pending_review', isArchived: false,
    }]);
    await service.approveReview(ORG, 'client-a', signer);
    expect(rows.cfContract).toHaveLength(1);
    expect(rows.cfContract[0]).toEqual(expect.objectContaining({ programId: 'program-enrolled', enrollmentId: 'enroll-a' }));
  });

  it('a closed enrollment yields no contract even though client.programId still points at its program', async () => {
    const { rows, service } = setup([{
      id: 'enroll-a', organizationId: ORG, clientId: 'client-a', programId: 'program-legacy',
      status: 'declined', isArchived: false,
    }]);
    await expect(service.generateForStaff(ORG, 'client-a', signer)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.generateForStaff(ORG, 'client-a', signer, { enrollmentId: 'enroll-a' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(rows.cfContract).toHaveLength(0);
  });
});
